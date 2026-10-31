// 入力（環境変数）を読み取り、検証済みの設定オブジェクトを返す。
import fs from "node:fs";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const MODES = ["auto", "review", "analyze", "learn"];
const SEVERITY_GATES = ["none", "critical", "high"];

function env(name, fallback = "") {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function bool(name) {
  return /^(1|true|yes|on)$/i.test(env(name, "false"));
}

function int(name, fallback) {
  const n = Number.parseInt(env(name, String(fallback)), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function splitList(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseRepo(full, label) {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(full || "");
  if (!m) throw new Error(`${label} は "owner/name" 形式で指定してください（受け取った値: "${full}"）`);
  return { owner: m[1], repo: m[2], full };
}

export function loadConfig() {
  const eventName = env("GITHUB_EVENT_NAME");
  const eventPath = env("GITHUB_EVENT_PATH");
  const event = eventPath && fs.existsSync(eventPath) ? JSON.parse(fs.readFileSync(eventPath, "utf8")) : {};

  const effort = env("AMON_EFFORT", "high");
  if (!EFFORTS.includes(effort)) throw new Error(`effort は ${EFFORTS.join(" | ")} のいずれかです: ${effort}`);
  const mode = env("AMON_MODE", "auto");
  if (!MODES.includes(mode)) throw new Error(`mode は ${MODES.join(" | ")} のいずれかです: ${mode}`);
  const gate = env("AMON_REQUEST_CHANGES_ON", "none");
  if (!SEVERITY_GATES.includes(gate)) throw new Error(`request-changes-on は ${SEVERITY_GATES.join(" | ")} のいずれかです: ${gate}`);

  const knowledgeRepoName = env("AMON_KNOWLEDGE_REPO") || env("AMON_ACTION_REPOSITORY") || env("GITHUB_ACTION_REPOSITORY");
  const dryRun = bool("AMON_DRY_RUN");

  const config = {
    dryRun,
    mode,
    model: env("AMON_MODEL", "claude-opus-5-5"),
    effort,
    language: env("AMON_LANGUAGE", "日本語"),
    profileMaxAgeDays: int("AMON_PROFILE_MAX_AGE_DAYS", 30),
    forceReanalyze: bool("AMON_FORCE_REANALYZE"),
    instructionsPath: env("AMON_INSTRUCTIONS_PATH", ".github/amon-reviewer.md"),
    ignorePaths: splitList(env("AMON_IGNORE_PATHS")),
    maxFindings: int("AMON_MAX_FINDINGS", 20),
    requestChangesOn: gate,
    anthropicApiKey: env("AMON_ANTHROPIC_API_KEY") || env("ANTHROPIC_API_KEY"),
    githubToken: env("AMON_GITHUB_TOKEN") || env("GITHUB_TOKEN"),
    knowledgeToken: env("AMON_KNOWLEDGE_TOKEN"),
    knowledgeBranch: env("AMON_KNOWLEDGE_BRANCH", "amon-knowledge"),
    knowledgeRepo: knowledgeRepoName ? parseRepo(knowledgeRepoName, "knowledge-repo") : null,
    target: parseRepo(env("GITHUB_REPOSITORY"), "GITHUB_REPOSITORY"),
    eventName,
    event,
  };

  if (!config.anthropicApiKey) throw new Error("anthropic-api-key が未設定です");
  if (!config.githubToken) throw new Error("github-token が未設定です");
  if (!config.knowledgeRepo) throw new Error("knowledge-repo を特定できませんでした。input で owner/name を指定してください");
  if (!config.knowledgeToken && !dryRun) throw new Error("knowledge-token が未設定です（dry-run 以外では必須）");
  return config;
}

/** イベント種別から実行モードを決める。 */
export function resolveMode(mode, eventName, event) {
  if (mode !== "auto") return mode;
  if (eventName === "pull_request" || eventName === "pull_request_target") {
    if (event.action === "closed") return "learn";
    return "review";
  }
  if (eventName === "workflow_dispatch" || eventName === "schedule" || eventName === "push") return "analyze";
  return "skip";
}
