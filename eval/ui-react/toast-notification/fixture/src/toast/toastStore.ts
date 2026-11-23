export type ToastVariant = "info" | "success" | "warning" | "error";

export type ToastOptions = {
  message: string;
  variant?: ToastVariant;
  /** 表示時間（ミリ秒）。省略時は <Toaster defaultDuration> */
  duration?: number;
  /** 通知の幅（px）。省略時・不正値は <Toaster defaultWidth> */
  width?: number;
};

export type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
  duration?: number;
  width?: number;
};

type Listener = (item: ToastItem) => void;

const listeners = new Set<Listener>();
let nextId = 1;

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const isValidDuration = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function toast(options: ToastOptions): void {
  // ホスト未マウント時は破棄（仕様どおり）
  if (listeners.size === 0) return;

  const item: ToastItem = {
    id: nextId++,
    message: options.message,
    variant: options.variant ?? "info",
    duration:
      options.duration === undefined
        ? undefined
        : isValidDuration(options.duration)
          ? options.duration
          : 5000,
    width: options.width,
  };
  listeners.forEach((listener) => listener(item));
}
