// amon-reviewer リポジトリ内（専用ブランチ）にリポジトリごとのプロファイルを保持する知識ストア。
//
// レイアウト（knowledge ブランチ上）:
//   profiles/<owner>/<repo>/profile.json   機械可読のプロファイル（次回レビューの前提）
//   profiles/<owner>/<repo>/PROFILE.md     人が読む用のレンダリング
//
// 書き込みは Git Data API で 1 コミットにまとめ、ref 更新を fast-forward のみに限定することで
// 同時実行時の上書きを防ぐ（衝突したら最新を読み直して mutator を再適用）。
import { renderProfileMarkdown } from "./profile.mjs";

export const SCHEMA_VERSION = 1;

const BRANCH_README = `# amon-reviewer knowledge

このブランチは amon-reviewer が自動管理します。各リポジトリを解析して得たアプリケーション特性
（プロファイル）と、マージ済み PR から学習したレビュー知見を保存しています。

- \`profiles/<owner>/<repo>/profile.json\` : レビュー時に前提として読み込まれるデータ
- \`profiles/<owner>/<repo>/PROFILE.md\` : 人が確認するためのレンダリング

内容を修正したい場合は profile.json を直接編集してコミットしてください（次回レビューから反映されます）。
`;

export function profileDir(target) {
  return `profiles/${target.owner}/${target.repo}`;
}

export function emptyRecord(target) {
  return {
    schemaVersion: SCHEMA_VERSION,
    repository: target.full,
    analyzedAt: null,
    analyzedCommit: null,
    defaultBranch: null,
    analyzerModel: null,
    profile: null,
    learnings: [],
    pendingLearnings: {},
    stats: { reviews: 0, lastReviewedAt: null, lastReviewedPr: null },
    history: [],
  };
}

export class KnowledgeStore {
  /**
   * @param {import("@octokit/rest").Octokit} octokit knowledge-token で認証したクライアント
   */
  constructor({ octokit, knowledgeRepo, branch, target, dryRun, log = console }) {
    this.octokit = octokit;
    this.owner = knowledgeRepo.owner;
    this.repo = knowledgeRepo.repo;
    this.branch = branch;
    this.target = target;
    this.dryRun = dryRun;
    this.log = log;
    this.dir = profileDir(target);
    this.jsonPath = `${this.dir}/profile.json`;
    this.mdPath = `${this.dir}/PROFILE.md`;
  }

  /** プロファイルを読む。存在しなければ空レコード。 */
  async load() {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: this.jsonPath,
        ref: this.branch,
      });
      if (Array.isArray(data) || data.type !== "file") throw new Error(`${this.jsonPath} がファイルではありません`);
      const raw = data.content
        ? Buffer.from(data.content, "base64").toString("utf8")
        : await this.#loadBlob(data.sha);
      const record = { ...emptyRecord(this.target), ...JSON.parse(raw) };
      return record;
    } catch (err) {
      if (err.status === 404) return emptyRecord(this.target);
      throw err;
    }
  }

  async #loadBlob(sha) {
    const { data } = await this.octokit.git.getBlob({ owner: this.owner, repo: this.repo, file_sha: sha });
    return Buffer.from(data.content, "base64").toString("utf8");
  }

  /**
   * 最新を読み → mutator で更新 → 1 コミットで保存。ref 更新が競合したら再試行する。
   * mutator が null を返したら保存しない。
   * @param {(record: object) => object | null | Promise<object | null>} mutator
   * @param {string} message コミットメッセージ
   */
  async update(mutator, message) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const current = await this.load();
      const next = await mutator(structuredClone(current));
      if (!next) return { saved: false, record: current };
      next.schemaVersion = SCHEMA_VERSION;

      if (this.dryRun) {
        this.log.info(`[dry-run] 知識ストアへの保存をスキップ: ${this.owner}/${this.repo}@${this.branch}:${this.jsonPath}`);
        return { saved: false, record: next };
      }
      try {
        await this.#commit(
          {
            [this.jsonPath]: JSON.stringify(next, null, 2) + "\n",
            [this.mdPath]: renderProfileMarkdown(next),
          },
          `${message} (${this.target.full})`,
        );
        return { saved: true, record: next };
      } catch (err) {
        // 422: fast-forward ではない（他ランが先にコミットした）→ 読み直して再適用
        if (err.status === 422 || err.status === 409) {
          this.log.warn(`知識ストアの更新が競合しました。再試行します (${attempt}/5)`);
          await new Promise((r) => setTimeout(r, 500 * attempt + Math.random() * 500));
          continue;
        }
        throw err;
      }
    }
    throw new Error("知識ストアの更新が競合により 5 回失敗しました");
  }

  async #headSha() {
    try {
      const { data } = await this.octokit.git.getRef({ owner: this.owner, repo: this.repo, ref: `heads/${this.branch}` });
      return data.object.sha;
    } catch (err) {
      if (err.status !== 404) throw err;
      return null;
    }
  }

  /** knowledge ブランチをコードと無関係な orphan ブランチとして作成する。 */
  async #createBranch() {
    const { owner, repo } = this;
    const { data: blob } = await this.octokit.git.createBlob({ owner, repo, content: BRANCH_README, encoding: "utf-8" });
    const { data: tree } = await this.octokit.git.createTree({
      owner,
      repo,
      tree: [{ path: "README.md", mode: "100644", type: "blob", sha: blob.sha }],
    });
    const { data: commit } = await this.octokit.git.createCommit({
      owner,
      repo,
      message: "chore: initialize amon-reviewer knowledge branch",
      tree: tree.sha,
      parents: [],
    });
    try {
      await this.octokit.git.createRef({ owner, repo, ref: `refs/heads/${this.branch}`, sha: commit.sha });
      this.log.info(`知識ストア用ブランチ ${this.branch} を作成しました`);
    } catch (err) {
      if (err.status !== 422) throw err; // 他ランが同時に作成済み
    }
    return this.#headSha();
  }

  async #commit(files, message) {
    const { owner, repo } = this;
    const parentSha = (await this.#headSha()) ?? (await this.#createBranch());
    const { data: parent } = await this.octokit.git.getCommit({ owner, repo, commit_sha: parentSha });

    const tree = [];
    for (const [path, content] of Object.entries(files)) {
      const { data: blob } = await this.octokit.git.createBlob({ owner, repo, content, encoding: "utf-8" });
      tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const { data: newTree } = await this.octokit.git.createTree({ owner, repo, base_tree: parent.tree.sha, tree });
    const { data: commit } = await this.octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.sha,
      parents: [parentSha],
    });
    // force: false → fast-forward でなければ 422
    await this.octokit.git.updateRef({ owner, repo, ref: `heads/${this.branch}`, sha: commit.sha, force: false });
    this.log.info(`知識ストアを更新しました: ${owner}/${repo}@${this.branch} ${commit.sha.slice(0, 7)}`);
  }
}
