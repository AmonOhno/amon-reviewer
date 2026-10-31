// プロファイル（リポジトリのアプリケーション特性）のスキーマ・鮮度判定・学習知見の管理・レンダリング。

/** Claude に構造化出力させるプロファイルの JSON Schema。 */
export const PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "application_type",
    "domain",
    "architecture",
    "languages",
    "frameworks",
    "data_stores",
    "external_integrations",
    "directory_map",
    "conventions",
    "testing",
    "security_sensitive_areas",
    "non_functional_priorities",
    "review_focus",
    "intentional_patterns",
    "glossary",
    "structural_paths",
    "open_questions",
  ],
  properties: {
    summary: { type: "string", description: "アプリケーションが何をするものかの要約（3〜6文）" },
    application_type: {
      type: "string",
      description: "例: Web API / SPA / SSR Web アプリ / モバイルアプリ / CLI / ライブラリ / バッチ / IaC / モノレポ など",
    },
    domain: { type: "string", description: "業務ドメインと主要ユースケース" },
    architecture: { type: "string", description: "レイヤ構成・モジュール境界・データフロー・デプロイ形態" },
    languages: { type: "array", items: { type: "string" } },
    frameworks: { type: "array", items: { type: "string" }, description: "主要フレームワーク/ライブラリ（バージョンが分かれば併記）" },
    data_stores: { type: "array", items: { type: "string" } },
    external_integrations: { type: "array", items: { type: "string" }, description: "外部 API / SaaS / メッセージング等" },
    directory_map: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "role"],
        properties: { path: { type: "string" }, role: { type: "string" } },
      },
    },
    conventions: { type: "array", items: { type: "string" }, description: "命名・エラーハンドリング・ログ・DI 等、コードから読み取れる規約" },
    testing: { type: "string", description: "テスト戦略・フレームワーク・テストの置き場所・CI での実行方法" },
    security_sensitive_areas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area", "reason"],
        properties: { area: { type: "string", description: "パスまたは機能領域" }, reason: { type: "string" } },
      },
    },
    non_functional_priorities: { type: "array", items: { type: "string" }, description: "性能・可用性・後方互換性など、このアプリで特に重要な非機能要件" },
    review_focus: {
      type: "array",
      description: "このリポジトリの PR レビューで特に重視すべき観点（一般論ではなくこのアプリ固有のもの）",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "rationale", "priority"],
        properties: {
          title: { type: "string" },
          rationale: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    intentional_patterns: {
      type: "array",
      items: { type: "string" },
      description: "一見問題に見えるが意図的と判断できる設計・慣習（レビューで誤検知しないため）",
    },
    glossary: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "meaning"],
        properties: { term: { type: "string" }, meaning: { type: "string" } },
      },
    },
    structural_paths: {
      type: "array",
      items: { type: "string" },
      description: "変更されるとアプリ特性が変わり得るパスの glob（依存定義・スキーマ・インフラ定義・CI 等）。プロファイル再解析のトリガーに使う",
    },
    open_questions: { type: "array", items: { type: "string" }, description: "コードからは判断できなかった点" },
  },
};

/** どのリポジトリでも「構造が変わった」とみなす既定パターン。 */
export const DEFAULT_STRUCTURAL_PATTERNS = [
  "package.json",
  "**/package.json",
  "go.mod",
  "**/go.mod",
  "pyproject.toml",
  "requirements*.txt",
  "Pipfile",
  "Gemfile",
  "Cargo.toml",
  "**/Cargo.toml",
  "composer.json",
  "pom.xml",
  "**/pom.xml",
  "build.gradle*",
  "**/build.gradle*",
  "settings.gradle*",
  "*.csproj",
  "**/*.csproj",
  "Dockerfile",
  "**/Dockerfile",
  "docker-compose*.y*ml",
  "**/schema.prisma",
  "**/migrations/**",
  "**/*.tf",
  ".github/workflows/**",
];

const MAX_LEARNINGS = 60;
const MAX_PENDING_PRS = 50;
const MAX_HISTORY = 30;

/** 簡易 glob → RegExp（`**`, `*`, `?` をサポート）。 */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // "**/" は 0 個以上のディレクトリ
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path, patterns) {
  return patterns.some((p) => globToRegExp(p).test(path));
}

/**
 * レビュー前にプロファイルを（再）解析すべきかを判定する。
 * @returns {{ needed: boolean, reason: string }}
 */
export function needsReanalysis(record, { now = new Date(), maxAgeDays, force, changedPaths = [] }) {
  if (force) return { needed: true, reason: "force-reanalyze が指定されました" };
  if (!record.profile || !record.analyzedAt) return { needed: true, reason: "プロファイルが未作成です（初回）" };
  const ageDays = (now.getTime() - new Date(record.analyzedAt).getTime()) / 86_400_000;
  if (maxAgeDays > 0 && ageDays > maxAgeDays) {
    return { needed: true, reason: `プロファイルが ${Math.floor(ageDays)} 日前のものです（上限 ${maxAgeDays} 日）` };
  }
  const patterns = [...DEFAULT_STRUCTURAL_PATTERNS, ...(record.profile.structural_paths || [])];
  const hit = changedPaths.find((p) => matchesAny(p, patterns));
  if (hit) return { needed: true, reason: `構造に関わるファイルが変更されました: ${hit}` };
  return { needed: false, reason: "既存プロファイルを利用します" };
}

function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
}

/** レビュー中に得た知見を PR 単位で保留領域に登録する（マージされるまで正式採用しない）。 */
export function addPendingLearnings(record, prNumber, learnings, now = new Date()) {
  const items = learnings.map((t) => String(t).trim()).filter(Boolean);
  if (!items.length) return record;
  record.pendingLearnings ||= {};
  record.pendingLearnings[String(prNumber)] = items.map((text) => ({ text, addedAt: now.toISOString() }));
  // 古い保留 PR を間引く
  const keys = Object.keys(record.pendingLearnings);
  if (keys.length > MAX_PENDING_PRS) {
    keys
      .sort((a, b) => Number(a) - Number(b))
      .slice(0, keys.length - MAX_PENDING_PRS)
      .forEach((k) => delete record.pendingLearnings[k]);
  }
  return record;
}

/** マージされた PR の保留知見を正式な learnings に昇格する。クローズ（未マージ）なら破棄。 */
export function settlePendingLearnings(record, prNumber, merged, now = new Date()) {
  const key = String(prNumber);
  const pending = record.pendingLearnings?.[key] || [];
  delete record.pendingLearnings?.[key];
  if (!merged || !pending.length) return { record, promoted: 0 };

  const seen = new Set(record.learnings.map((l) => normalize(l.text)));
  let promoted = 0;
  for (const { text } of pending) {
    const n = normalize(text);
    if (seen.has(n)) continue;
    seen.add(n);
    record.learnings.push({ text, sourcePr: Number(prNumber), addedAt: now.toISOString() });
    promoted++;
  }
  if (record.learnings.length > MAX_LEARNINGS) record.learnings = record.learnings.slice(-MAX_LEARNINGS);
  return { record, promoted };
}

export function pushHistory(record, entry) {
  record.history = [...(record.history || []), entry].slice(-MAX_HISTORY);
  return record;
}

const list = (items, fmt = (x) => x) => (items?.length ? items.map((x) => `- ${fmt(x)}`).join("\n") : "- （なし）");

/** レビュープロンプトに埋め込むためのプロファイル表現。 */
export function renderProfileForPrompt(record) {
  const p = record.profile;
  if (!p) return "（このリポジトリのプロファイルはまだありません）";
  const focus = [...(p.review_focus || [])].sort(
    (a, b) => ["high", "medium", "low"].indexOf(a.priority) - ["high", "medium", "low"].indexOf(b.priority),
  );
  return [
    `リポジトリ: ${record.repository}（解析コミット ${record.analyzedCommit?.slice(0, 7) ?? "?"}, ${record.analyzedAt ?? "?"}）`,
    `## 概要\n${p.summary}`,
    `## 種別 / ドメイン\n- 種別: ${p.application_type}\n- ドメイン: ${p.domain}`,
    `## アーキテクチャ\n${p.architecture}`,
    `## 技術スタック\n- 言語: ${p.languages.join(", ") || "-"}\n- フレームワーク: ${p.frameworks.join(", ") || "-"}\n- データストア: ${p.data_stores.join(", ") || "-"}\n- 外部連携: ${p.external_integrations.join(", ") || "-"}`,
    `## ディレクトリの役割\n${list(p.directory_map, (d) => `\`${d.path}\`: ${d.role}`)}`,
    `## コード規約\n${list(p.conventions)}`,
    `## テスト\n${p.testing}`,
    `## セキュリティ上センシティブな領域\n${list(p.security_sensitive_areas, (s) => `${s.area}: ${s.reason}`)}`,
    `## 重視すべき非機能要件\n${list(p.non_functional_priorities)}`,
    `## このリポジトリ固有のレビュー重点\n${list(focus, (f) => `[${f.priority}] ${f.title} — ${f.rationale}`)}`,
    `## 意図的なパターン（指摘しないこと）\n${list(p.intentional_patterns)}`,
    `## 用語\n${list(p.glossary, (g) => `${g.term}: ${g.meaning}`)}`,
    `## 過去のレビューで蓄積された知見（マージ済み PR 由来）\n${list(record.learnings, (l) => `${l.text}（#${l.sourcePr}）`)}`,
  ].join("\n\n");
}

/** 知識ストアに置く人間向け Markdown。 */
export function renderProfileMarkdown(record) {
  const header = [
    `# ${record.repository} — amon-reviewer profile`,
    "",
    `> このファイルは profile.json から自動生成されます。修正は profile.json に対して行ってください。`,
    "",
    `| 項目 | 値 |`,
    `|---|---|`,
    `| 解析日時 | ${record.analyzedAt ?? "-"} |`,
    `| 解析コミット | ${record.analyzedCommit ?? "-"} (${record.defaultBranch ?? "-"}) |`,
    `| 解析モデル | ${record.analyzerModel ?? "-"} |`,
    `| レビュー回数 | ${record.stats?.reviews ?? 0}（最終: ${record.stats?.lastReviewedAt ?? "-"} / PR #${record.stats?.lastReviewedPr ?? "-"}） |`,
    `| 保留中の知見 | ${Object.values(record.pendingLearnings || {}).flat().length} 件 |`,
    "",
  ].join("\n");
  const p = record.profile;
  const extra = p
    ? `\n\n## 構造変化とみなすパス\n${list(p.structural_paths, (s) => `\`${s}\``)}\n\n## 未解決の疑問\n${list(p.open_questions)}`
    : "";
  return `${header}\n${renderProfileForPrompt(record)}${extra}\n`;
}
