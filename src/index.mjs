// amon-reviewer エントリポイント。
//   review : PR をレビュー（プロファイルが無い/古ければ先に解析）。レビューで得た知見は「保留」として保存
//   learn  : PR クローズ時。マージされていれば保留知見を正式採用し、構造的変更があればプロファイルを再解析
//   analyze: プロファイルを（再）解析して保存（workflow_dispatch / schedule 用）
import fs from "node:fs";
import { loadConfig, resolveMode } from "./config.mjs";
import { createOctokit, TargetRepo } from "./github.mjs";
import { KnowledgeStore } from "./knowledge-store.mjs";
import { ClaudeClient } from "./claude.mjs";
import { analyzeRepository } from "./repo-analyzer.mjs";
import { needsReanalysis, addPendingLearnings, settlePendingLearnings, pushHistory } from "./profile.mjs";
import { reviewPullRequest, partitionFindings, renderInlineComment, renderReviewBody, SEVERITIES, MARKER } from "./reviewer.mjs";

const log = {
  info: (m) => console.log(m),
  warn: (m) => console.log(`::warning::${m}`),
  error: (m) => console.log(`::error::${m}`),
};

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function appendSummary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
}

/** 解析を実行してレコードに反映し保存する。 */
async function runAnalysis(ctx, reason) {
  const { store, repo, claude, config } = ctx;
  log.info(`プロファイルを解析します: ${reason}`);
  const previous = await store.load();
  const result = await analyzeRepository({ repo, claude, language: config.language, log }, { previous });
  const now = new Date().toISOString();
  const { record, saved } = await store.update((rec) => {
    rec.profile = result.profile;
    rec.analyzedAt = now;
    rec.analyzedCommit = result.analyzedCommit;
    rec.defaultBranch = result.defaultBranch;
    rec.analyzerModel = config.model;
    return pushHistory(rec, { at: now, event: "analyze", reason, commit: result.analyzedCommit, files: result.filesUsed.length });
  }, "profile: analyze repository");
  appendSummary(`### amon-reviewer: プロファイル解析\n- 理由: ${reason}\n- コミット: \`${result.analyzedCommit}\`\n- 参照ファイル: ${result.filesUsed.length} 件\n`);
  return { record, saved };
}

async function modeReview(ctx) {
  const { config, repo, store, claude } = ctx;
  const prNumber = config.event.pull_request?.number ?? config.event.number;
  if (!prNumber) throw new Error("PR 番号を特定できません（pull_request イベントで実行してください）");
  const pr = await repo.getPull(prNumber);
  if (pr.draft) {
    log.info("ドラフト PR のためスキップします（ready_for_review で再実行されます）");
    return;
  }
  if (pr.state !== "open") {
    log.info(`PR #${prNumber} は ${pr.state} のためレビューしません`);
    return;
  }

  // 1. プロファイルの用意（初回/期限切れ/強制のみ再解析。未マージ PR の構造変更は learn 時に反映）
  let record = await store.load();
  const decision = needsReanalysis(record, { maxAgeDays: config.profileMaxAgeDays, force: config.forceReanalyze });
  let profileStatus = "既存プロファイルを使用";
  let profileUpdated = false;
  if (decision.needed) {
    try {
      ({ record } = await runAnalysis(ctx, decision.reason));
      profileStatus = `今回解析（${decision.reason}）`;
      profileUpdated = true;
    } catch (err) {
      // 解析に失敗しても、既存プロファイル or 一般観点のみでレビューは続行する
      log.warn(`プロファイル解析に失敗しました: ${err.message}`);
      profileStatus = record.profile ? "解析失敗のため既存プロファイルを使用" : "解析失敗のため一般観点のみ";
    }
  }
  setOutput("profile-updated", String(profileUpdated));

  // 2. リポジトリ側の追加指示（デフォルトブランチから読む：PR で書き換えられないように）
  const instructions = config.instructionsPath
    ? await repo.getText(config.instructionsPath, record.defaultBranch || pr.base.ref)
    : null;

  // 3. レビュー
  const files = await repo.listPullFiles(prNumber);
  const { review, diff } = await reviewPullRequest({ repo, claude, config, log }, { pr, files, record, instructions });
  if (!review) {
    log.info("レビュー対象の差分がありません");
    setOutput("findings-count", "0");
    return;
  }

  const previousFingerprints = await repo.listPreviousFingerprints(prNumber, MARKER);
  const { inline, general, duplicates } = partitionFindings(review.findings, diff.included, {
    maxFindings: config.maxFindings,
    previousFingerprints,
  });
  const body = renderReviewBody({ review, inline, general, duplicates, omitted: diff.omitted, profileStatus, record });

  const gateIdx = SEVERITIES.indexOf(config.requestChangesOn);
  const blocking = gateIdx >= 0 && [...inline, ...general].some((f) => SEVERITIES.indexOf(f.severity) <= gateIdx);
  const event = blocking ? "REQUEST_CHANGES" : "COMMENT";
  const comments = inline.map((f) => ({
    path: f.path,
    line: f.line,
    side: "RIGHT",
    ...(f.start_line < f.line ? { start_line: f.start_line, start_side: "RIGHT" } : {}),
    body: renderInlineComment(f),
  }));

  if (config.dryRun) {
    log.info(`[dry-run] review event=${event}\n${body}\n\n${comments.map((c) => `--- ${c.path}:${c.line}\n${c.body}`).join("\n")}`);
  } else {
    try {
      await repo.createReview({ number: prNumber, commitId: pr.head.sha, body, event, comments });
    } catch (err) {
      if (err.status !== 422) throw err;
      // 行位置の不整合などでインラインが拒否された場合は本文にまとめて投稿
      log.warn(`インラインコメント付きレビューの投稿に失敗したため本文に集約します: ${err.message}`);
      const fallback = renderReviewBody({ review, inline: [], general: [...inline, ...general], duplicates, omitted: diff.omitted, profileStatus, record });
      await repo.createReview({ number: prNumber, commitId: pr.head.sha, body: fallback, event, comments: [] });
    }
  }
  setOutput("findings-count", String(inline.length + general.length));
  appendSummary(`### amon-reviewer: PR #${prNumber}\n- 指摘: インライン ${inline.length} / 全体 ${general.length}（重複省略 ${duplicates}）\n- リスク: ${review.overall_risk}\n- 学習候補: ${review.learnings.length} 件（マージ時に採用）\n`);

  // 4. 統計と学習候補を保存（候補はマージされた時点で正式な知見に昇格）
  await store.update((rec) => {
    rec.stats = { reviews: (rec.stats?.reviews ?? 0) + 1, lastReviewedAt: new Date().toISOString(), lastReviewedPr: prNumber };
    return addPendingLearnings(rec, prNumber, review.learnings);
  }, `review: PR #${prNumber}`);
}

async function modeLearn(ctx) {
  const { config, repo, store } = ctx;
  const pr = config.event.pull_request;
  if (!pr) throw new Error("learn モードは pull_request (closed) イベントで実行してください");
  const merged = Boolean(pr.merged);
  let promoted = 0;
  const { record } = await store.update((rec) => {
    const r = settlePendingLearnings(rec, pr.number, merged);
    promoted = r.promoted;
    return r.record;
  }, `learn: PR #${pr.number} ${merged ? "merged" : "closed"}`);
  log.info(`PR #${pr.number} ${merged ? "マージ" : "クローズ"}: 知見 ${promoted} 件を採用`);
  setOutput("profile-updated", String(promoted > 0));

  if (!merged) return;
  const files = await repo.listPullFiles(pr.number);
  const decision = needsReanalysis(record, {
    maxAgeDays: config.profileMaxAgeDays,
    force: config.forceReanalyze,
    changedPaths: files.map((f) => f.filename),
  });
  if (decision.needed) {
    await runAnalysis(ctx, `PR #${pr.number} マージ後: ${decision.reason}`);
    setOutput("profile-updated", "true");
  }
}

async function main() {
  const config = loadConfig();
  const mode = resolveMode(config.mode, config.eventName, config.event);
  log.info(`amon-reviewer: mode=${mode} target=${config.target.full} knowledge=${config.knowledgeRepo.full}@${config.knowledgeBranch} model=${config.model}`);
  setOutput("profile-path", `profiles/${config.target.owner}/${config.target.repo}/profile.json`);
  if (mode === "skip") {
    log.info(`イベント ${config.eventName} は対象外のためスキップします`);
    return;
  }

  const ctx = {
    config,
    repo: new TargetRepo({ octokit: createOctokit(config.githubToken), target: config.target, log }),
    store: new KnowledgeStore({
      octokit: createOctokit(config.knowledgeToken || config.githubToken),
      knowledgeRepo: config.knowledgeRepo,
      branch: config.knowledgeBranch,
      target: config.target,
      dryRun: config.dryRun,
      log,
    }),
    claude: new ClaudeClient({ apiKey: config.anthropicApiKey, model: config.model, effort: config.effort, log }),
  };

  if (mode === "review") await modeReview(ctx);
  else if (mode === "learn") await modeLearn(ctx);
  else if (mode === "analyze") {
    await runAnalysis(ctx, config.forceReanalyze ? "force-reanalyze" : `${config.eventName} による定期/手動解析`);
    setOutput("profile-updated", "true");
  }
}

main().catch((err) => {
  log.error(err.stack || err.message);
  process.exitCode = 1;
});
