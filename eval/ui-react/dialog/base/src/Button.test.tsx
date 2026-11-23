import { test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "./Button";

test("クリックで onClick が呼ばれる", () => {
  let clicked = 0;
  render(<Button onClick={() => clicked++}>保存</Button>);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  assert.equal(clicked, 1);
});
