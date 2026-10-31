import { test } from "node:test";
import assert from "node:assert/strict";
import { commentableLines, annotatePatch, buildDiffContext } from "../src/diff.mjs";
import { partitionFindings, fingerprint, renderInlineComment, renderReviewBody } from "../src/reviewer.mjs";
import { selectFiles, summarizeTree } from "../src/repo-analyzer.mjs";

const patch = [
  "@@ -10,4 +10,5 @@ function a() {",
  " const x = 1;",
  "-const y = 2;",
  "+const y = 3;",
  "+const z = 4;",
  " return x;",
  "@@ -40,2 +41,2 @@",
  " foo();",
  "-bar();",
  "+baz();",
  "\\ No newline at end of file",
].join("\n");

test("commentableLines は RIGHT 側の追加行・文脈行のみ", () => {
  assert.deepEqual([...commentableLines(patch)], [10, 11, 12, 13, 41, 42]);
});

test("annotatePatch は新ファイル側の行番号を付ける", () => {
  const a = annotatePatch(patch).split("\n");
  assert.match(a[1], /^\s+10\s{3}const x/);
  assert.match(a[2], /^\s+- const y = 2/);
  assert.match(a[3], /^\s+11 \+ const y = 3/);
});

test("buildDiffContext は lock ファイルと ignore を除外", () => {
  const files = [
    { filename: "package-lock.json", status: "modified", patch },
    { filename: "src/a.ts", status: "modified", patch },
    { filename: "gen/b.ts", status: "added", patch },
    { filename: "img.png", status: "added" },
  ];
  const d = buildDiffContext(files, { ignore: ["gen/**"] });
  assert.deepEqual(d.included.map((f) => f.path), ["src/a.ts"]);
  assert.equal(d.omitted.length, 3);
});

const finding = (o) => ({ path: "src/a.ts", start_line: 11, line: 12, severity: "medium", category: "correctness", title: "t", body: "b", suggestion: "", based_on_profile: false, ...o });

test("partitionFindings: 行検証・重大度順・上限・重複除外", () => {
  const diffFiles = [{ path: "src/a.ts", patch }];
  const findings = [
    finding({ title: "low one", severity: "low" }),
    finding({ title: "outside", line: 99, start_line: 99, severity: "high" }),
    finding({ title: "critical", severity: "critical", start_line: 5 }),
    finding({ title: "dup", severity: "high" }),
    finding({ title: "other file", path: "src/x.ts" }),
  ];
  const prev = new Set([fingerprint({ path: "src/a.ts", title: "DUP" })]);
  const { inline, general, duplicates } = partitionFindings(findings, diffFiles, { maxFindings: 1, previousFingerprints: prev });
  assert.equal(duplicates, 1);
  assert.deepEqual(inline.map((f) => f.title), ["critical"]);
  assert.equal(inline[0].start_line, 12, "差分外の start_line は単一行に丸める");
  assert.deepEqual(general.map((f) => f.title), ["outside", "other file", "low one"]);
});

test("renderInlineComment は suggestion と指紋を含む", () => {
  const c = renderInlineComment({ ...finding({ suggestion: "const y = 5;\n", based_on_profile: true }), fp: "abc123" });
  assert.match(c, /```suggestion\nconst y = 5;\n```/);
  assert.match(c, /<!-- amon-reviewer:fp=abc123 -->/);
  assert.match(c, /🧭/);
});

test("renderReviewBody", () => {
  const body = renderReviewBody({
    review: { summary: "S", overall_risk: "medium" },
    inline: [finding({ fp: "1" })],
    general: [finding({ fp: "2", severity: "high" })],
    duplicates: 2,
    omitted: [{ path: "x", reason: "r" }],
    profileStatus: "既存",
    record: { analyzedCommit: "abcdef123", learnings: [] },
  });
  assert.match(body, /🟠 high: 1/);
  assert.match(body, /指摘済みの 2 件/);
});

test("selectFiles は除外ディレクトリを避け、グループ上限内で選ぶ", () => {
  const entries = [
    { path: "README.md", size: 2000 },
    { path: "package.json", size: 800 },
    { path: "node_modules/x/package.json", size: 100 },
    { path: "package-lock.json", size: 100000 },
    { path: ".github/workflows/ci.yml", size: 500 },
    { path: "prisma/schema.prisma", size: 3000 },
    ...Array.from({ length: 30 }, (_, i) => ({ path: `src/routes/r${i}.ts`, size: 1000 })),
    { path: "src/index.ts", size: 400 },
    { path: "logo.png", size: 4000 },
  ];
  const chosen = selectFiles(entries);
  const paths = chosen.map((c) => c.path);
  assert.ok(paths.includes("README.md") && paths.includes("package.json") && paths.includes("prisma/schema.prisma"));
  assert.ok(!paths.some((p) => p.startsWith("node_modules") || p.endsWith(".png") || p.endsWith("lock.json")));
  assert.ok(paths.filter((p) => p.startsWith("src/routes/")).length <= 2);
  assert.match(summarizeTree(entries), /総ファイル数（解析対象）: 35/);
});
