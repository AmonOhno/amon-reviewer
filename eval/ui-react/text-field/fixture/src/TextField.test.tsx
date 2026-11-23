import { test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, render } from "@testing-library/react";
import { TextField } from "./TextField";

test("入力した値が表示される", () => {
  const { container } = render(<TextField label="氏名" />);
  const input = container.querySelector(".text-field__input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "山田" } });
  assert.equal(input.value, "山田");
});

test("エラー時は枠線が赤くなる", () => {
  const { container } = render(<TextField label="氏名" error="入力してください" />);
  const input = container.querySelector(".text-field__input") as HTMLInputElement;
  assert.equal(input.style.borderColor, "rgb(211, 47, 47)");
});
