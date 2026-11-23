import { useEffect, useRef, useState } from "react";
import { subscribeToast, type ToastItem, type ToastVariant } from "./toastStore";

const COLORS: Record<ToastVariant, string> = {
  info: "#1E88E5",
  success: "#00B19D",
  warning: "#F4B142",
  error: "#E91E63",
};

type ToasterProps = {
  defaultDuration?: number;
  defaultWidth?: number;
};

const isValidWidth = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function Toaster({ defaultDuration = 5000, defaultWidth = 360 }: ToasterProps) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [boundsWidth, setBoundsWidth] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const hostDuration = defaultDuration > 0 ? defaultDuration : 5000;

  useEffect(
    () =>
      subscribeToast((item) => {
        setItems((prev) => [...prev, item]);
        setTimeout(() => {
          setItems((prev) => prev.filter((i) => i.id !== item.id));
        }, item.duration ?? hostDuration);
      }),
    [hostDuration],
  );

  useEffect(() => {
    const update = () => {
      const rect = rootRef.current?.parentElement?.getBoundingClientRect();
      if (rect) setBoundsWidth(rect.width);
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="toaster"
      style={{ position: "fixed", top: 16, right: 16, maxWidth: boundsWidth || undefined }}
    >
      {items.map((item) => (
        <div
          key={item.id}
          role={item.variant === "error" ? "alert" : "status"}
          style={{
            background: COLORS[item.variant],
            color: "#FFFFFF",
            fontSize: 14,
            padding: "8px 12px",
            marginBottom: 8,
            borderRadius: 4,
            width: isValidWidth(item.width) ? item.width : defaultWidth,
          }}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
