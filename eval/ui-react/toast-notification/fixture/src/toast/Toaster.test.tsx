import { test } from "node:test";
import assert from "node:assert/strict";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Toaster } from "./Toaster";
import { toast } from "./toastStore";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.afterEach(() => cleanup());

test("通知が表示される", () => {
  render(<Toaster />);
  act(() => toast({ message: "保存しました", variant: "success" }));
  assert.ok(screen.getByText("保存しました"));
});

test("指定した duration で消える", async () => {
  render(<Toaster />);
  act(() => toast({ message: "すぐ消える", duration: 300 }));
  await act(() => sleep(400));
  assert.equal(screen.queryByText("すぐ消える"), null);
});

test("不正な duration は 5000ms で消える", async () => {
  render(<Toaster />);
  act(() => toast({ message: "不正な duration", duration: -1 }));
  await act(() => sleep(5100));
  assert.equal(screen.queryByText("不正な duration"), null);
});

test("不正な width はホストの既定幅になる", () => {
  render(<Toaster defaultWidth={320} />);
  act(() => toast({ message: "幅", width: Number.NaN }));
  assert.equal(screen.getByText("幅").style.width, "320px");
});
