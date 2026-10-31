// レビュー対象リポジトリに対する GitHub API 操作。
// 解析はローカルのチェックアウトではなく API 経由でデフォルトブランチを読む。
// （PR の未マージコードがプロファイルに混入しないようにするため。checkout も不要になる）
import { Octokit } from "@octokit/rest";

export function createOctokit(token) {
  return new Octokit({ auth: token, userAgent: "amon-reviewer" });
}

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|jar|war|class|so|dylib|dll|exe|bin|woff2?|ttf|eot|otf|mp[34]|mov|avi|wasm|pyc|lockb)$/i;

export function isProbablyBinary(path) {
  return BINARY_EXT.test(path);
}

export class TargetRepo {
  constructor({ octokit, target, log = console }) {
    this.octokit = octokit;
    this.owner = target.owner;
    this.repo = target.repo;
    this.log = log;
  }

  get #base() {
    return { owner: this.owner, repo: this.repo };
  }

  async getRepoInfo() {
    const { data } = await this.octokit.repos.get(this.#base);
    return { defaultBranch: data.default_branch, description: data.description, topics: data.topics || [] };
  }

  async getBranchHead(branch) {
    const { data } = await this.octokit.repos.getBranch({ ...this.#base, branch });
    return data.commit.sha;
  }

  /** 再帰ツリー（blob のみ）を返す。 */
  async getTree(sha) {
    const { data } = await this.octokit.git.getTree({ ...this.#base, tree_sha: sha, recursive: "true" });
    if (data.truncated) this.log.warn("リポジトリツリーが大きすぎるため一部のみ取得しました");
    return data.tree.filter((e) => e.type === "blob").map((e) => ({ path: e.path, size: e.size ?? 0, sha: e.sha }));
  }

  /** テキストファイルを取得。無い・バイナリ・大きすぎる場合は null。 */
  async getText(path, ref, { maxBytes = 400_000 } = {}) {
    if (isProbablyBinary(path)) return null;
    try {
      const { data } = await this.octokit.repos.getContent({ ...this.#base, path, ref });
      if (Array.isArray(data) || data.type !== "file") return null;
      if (data.size > maxBytes) return null;
      let buf;
      if (data.content) buf = Buffer.from(data.content, "base64");
      else {
        const { data: blob } = await this.octokit.git.getBlob({ ...this.#base, file_sha: data.sha });
        buf = Buffer.from(blob.content, "base64");
      }
      if (buf.includes(0)) return null; // バイナリ
      return buf.toString("utf8");
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async getPull(number) {
    const { data } = await this.octokit.pulls.get({ ...this.#base, pull_number: number });
    return data;
  }

  async listPullFiles(number) {
    return this.octokit.paginate(this.octokit.pulls.listFiles, { ...this.#base, pull_number: number, per_page: 100 });
  }

  /** 過去に amon-reviewer が付けたインラインコメントの指紋一覧（重複投稿防止用）。 */
  async listPreviousFingerprints(number, marker) {
    const comments = await this.octokit.paginate(this.octokit.pulls.listReviewComments, {
      ...this.#base,
      pull_number: number,
      per_page: 100,
    });
    const fps = new Set();
    const re = new RegExp(`<!-- ${marker}:fp=([a-f0-9]+) -->`);
    for (const c of comments) {
      const m = re.exec(c.body || "");
      if (m) fps.add(m[1]);
    }
    return fps;
  }

  async createReview({ number, commitId, body, event, comments }) {
    const { data } = await this.octokit.pulls.createReview({
      ...this.#base,
      pull_number: number,
      commit_id: commitId,
      body,
      event,
      comments,
    });
    return data;
  }

  async createIssueComment(number, body) {
    await this.octokit.issues.createComment({ ...this.#base, issue_number: number, body });
  }
}
