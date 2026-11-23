import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "@testing-library/react";
import { Dialog } from "./Dialog";

test("開いた状態のスナップショット", () => {
  render(
    <Dialog open title="削除の確認" onClose={() => {}}>
      本当に削除しますか？
    </Dialog>,
  );
  assert.ok(document.body.innerHTML.includes("削除の確認"));
});
