import { test } from "node:test";
import assert from "node:assert/strict";
import { globToRegExp, matchesAny, needsReanalysis, addPendingLearnings, settlePendingLearnings, renderProfileMarkdown } from "../src/profile.mjs";
import { emptyRecord } from "../src/knowledge-store.mjs";
import { resolveMode } from "../src/config.mjs";

const target = { owner: "acme", repo: "shop", full: "acme/shop" };

test("globToRegExp", () => {
  assert.ok(globToRegExp("**/package.json").test("package.json"));
  assert.ok(globToRegExp("**/package.json").test("apps/web/package.json"));
  assert.ok(globToRegExp("*.tf").test("main.tf"));
  assert.ok(!globToRegExp("*.tf").test("infra/main.tf"));
  assert.ok(globToRegExp("**/migrations/**").test("db/migrations/001_init.sql"));
  assert.ok(globToRegExp("requirements*.txt").test("requirements-dev.txt"));
  assert.ok(!globToRegExp("src/a.ts").test("src/aXts"));
});

test("needsReanalysis: 初回・期限切れ・構造変更・強制", () => {
  const now = new Date("2026-10-31T00:00:00Z");
  const rec = emptyRecord(target);
  assert.equal(needsReanalysis(rec, { now, maxAgeDays: 30 }).needed, true);

  rec.profile = { structural_paths: ["config/tenants/**"] };
  rec.analyzedAt = "2026-10-20T00:00:00Z";
  assert.equal(needsReanalysis(rec, { now, maxAgeDays: 30 }).needed, false);
  assert.equal(needsReanalysis(rec, { now, maxAgeDays: 5 }).needed, true);
  assert.equal(needsReanalysis(rec, { now, maxAgeDays: 0 }).needed, false, "0 は期限なし");
  assert.equal(needsReanalysis(rec, { now, maxAgeDays: 30, changedPaths: ["src/a.ts"] }).needed, false);
  assert.equal(needsReanalysis(rec, { now, maxAgeDays: 30, changedPaths: ["apps/api/go.mod"] }).needed, true);
  assert.equal(needsReanalysis(rec, { now, maxAgeDays: 30, changedPaths: ["config/tenants/a.yml"] }).needed, true, "プロファイル固有パス");
  assert.equal(needsReanalysis(rec, { now, maxAgeDays: 30, force: true }).needed, true);
});

test("保留知見はマージ時のみ昇格し、重複は除外される", () => {
  let rec = emptyRecord(target);
  rec = addPendingLearnings(rec, 10, ["金額は必ず Money 型で扱う", "  "]);
  rec = addPendingLearnings(rec, 11, ["テストは testcontainers を使う"]);
  assert.equal(rec.pendingLearnings["10"].length, 1);

  let r = settlePendingLearnings(rec, 11, false);
  assert.equal(r.promoted, 0);
  assert.equal(r.record.pendingLearnings["11"], undefined);

  r = settlePendingLearnings(r.record, 10, true);
  assert.equal(r.promoted, 1);
  assert.deepEqual(r.record.learnings.map((l) => [l.text, l.sourcePr]), [["金額は必ず Money 型で扱う", 10]]);

  r.record = addPendingLearnings(r.record, 12, ["金額は必ず  Money 型で扱う"]);
  assert.equal(settlePendingLearnings(r.record, 12, true).promoted, 0);
});

test("renderProfileMarkdown はプロファイル未作成でも落ちない", () => {
  const md = renderProfileMarkdown(emptyRecord(target));
  assert.match(md, /acme\/shop/);
});

test("resolveMode", () => {
  assert.equal(resolveMode("auto", "pull_request", { action: "opened" }), "review");
  assert.equal(resolveMode("auto", "pull_request", { action: "closed" }), "learn");
  assert.equal(resolveMode("auto", "workflow_dispatch", {}), "analyze");
  assert.equal(resolveMode("auto", "issue_comment", {}), "skip");
  assert.equal(resolveMode("analyze", "pull_request", { action: "opened" }), "analyze");
});
