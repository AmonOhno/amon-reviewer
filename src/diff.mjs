// unified diff（GitHub の pulls.listFiles の patch）を扱うユーティリティ。
import { matchesAny } from "./profile.mjs";

/** patch 内で RIGHT 側（新しいファイル）にコメント可能な行番号の集合。 */
export function commentableLines(patch) {
  const lines = new Set();
  if (!patch) return lines;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      newLine = Number(h[1]);
      continue;
    }
    if (raw.startsWith("-")) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw.startsWith("+") || raw.startsWith(" ") || raw === "") {
      lines.add(newLine);
      newLine++;
    }
  }
  return lines;
}

/**
 * モデルが正確な行番号を引用できるよう、patch の各行に新ファイル側の行番号を付ける。
 *   "  42 + foo()"   追加行
 *   "  43   bar()"   文脈行
 *   "     - baz()"   削除行（新ファイル側に行番号なし）
 */
export function annotatePatch(patch) {
  if (!patch) return "";
  const out = [];
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      newLine = Number(h[1]);
      out.push(raw);
      continue;
    }
    if (raw.startsWith("\\")) continue;
    if (raw.startsWith("-")) {
      out.push(`${" ".repeat(6)}- ${raw.slice(1)}`);
    } else if (raw.startsWith("+")) {
      out.push(`${String(newLine).padStart(5)} + ${raw.slice(1)}`);
      newLine++;
    } else {
      out.push(`${String(newLine).padStart(5)}   ${raw.slice(1)}`);
      newLine++;
    }
  }
  return out.join("\n");
}

export const DEFAULT_IGNORE = [
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/Gemfile.lock",
  "**/poetry.lock",
  "**/Cargo.lock",
  "**/composer.lock",
  "**/go.sum",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.snap",
  "**/dist/**",
  "**/vendor/**",
  "**/__generated__/**",
  "**/*.generated.*",
  "**/*.pb.go",
];

/**
 * レビューに渡す差分を予算内で組み立てる。
 * @returns {{ included: Array<{path:string,status:string,patch:string}>, omitted: Array<{path:string,reason:string}>, text: string }}
 */
export function buildDiffContext(files, { ignore = [], maxChars = 240_000, perFileChars = 40_000 } = {}) {
  const patterns = [...DEFAULT_IGNORE, ...ignore];
  const included = [];
  const omitted = [];
  let used = 0;
  // 変更量の小さいものから詰めると多くのファイルを見られるが、重要な大変更が落ちる。
  // ここでは GitHub の並び順（パス順）を維持し、予算超過分を omitted に回す。
  for (const f of files) {
    if (matchesAny(f.filename, patterns)) {
      omitted.push({ path: f.filename, reason: "除外パターンに一致" });
      continue;
    }
    if (!f.patch) {
      omitted.push({ path: f.filename, reason: f.status === "removed" ? "削除" : "差分なし/バイナリ/巨大" });
      continue;
    }
    const annotated = annotatePatch(f.patch);
    if (annotated.length > perFileChars) {
      omitted.push({ path: f.filename, reason: `差分が大きすぎる (${annotated.length} 文字)` });
      continue;
    }
    if (used + annotated.length > maxChars) {
      omitted.push({ path: f.filename, reason: "差分全体の予算超過" });
      continue;
    }
    used += annotated.length;
    included.push({ path: f.filename, status: f.status, previous: f.previous_filename, patch: f.patch, annotated });
  }
  const text = included
    .map((f) => `<diff path="${f.path}" status="${f.status}"${f.previous ? ` previous="${f.previous}"` : ""}>\n${f.annotated}\n</diff>`)
    .join("\n\n");
  return { included, omitted, text };
}
