import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { markThreadRead } from "../api";
import { setThreadMute } from "../topicPreferences";
import type { Account } from "../types";
export type TopicMenuTarget = {
  channelId: number;
  topic: string;
  x: number;
  y: number;
  trigger: HTMLElement;
};
export function TopicMenu({
  account,
  target,
  muted,
  onOpen,
  onClose,
}: {
  account: Account;
  target: TopicMenuTarget;
  muted: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const ref = useRef<HTMLDivElement>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current!;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(target.x, innerWidth - rect.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(target.y, innerHeight - rect.height - 8))}px`;
    el.querySelector<HTMLButtonElement>("button")?.focus();
  }, [target]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      if (target.trigger.isConnected) target.trigger.focus();
    };
  }, [target, onClose]);
  const mute = (duration: number | null | "off") => {
    try {
      setThreadMute(account.id, target.channelId, target.topic, duration);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div
      className="topic-context-menu"
      ref={ref}
      role="menu"
      aria-label={`Thread options: ${target.topic}`}
      style={{ left: target.x, top: target.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Tab") {
          if (e.key === "Escape") e.preventDefault();
          onClose();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const items = [
          ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        const i = items.indexOf(document.activeElement as HTMLButtonElement),
          n =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? items.length - 1
                : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length;
        items[n]?.focus();
      }}
    >
      <strong>{target.topic || "(no topic)"}</strong>
      <button
        role="menuitem"
        onClick={() => {
          onOpen();
          onClose();
        }}
      >
        Open thread
      </button>
      <button
        role="menuitem"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            operation.current = new AbortController();
            await markThreadRead(
              account,
              target.channelId,
              target.topic,
              operation.current.signal,
            );
            onClose();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        Mark thread read
      </button>
      <span className="menu-section">Mute notifications in this browser</span>
      {muted && (
        <button role="menuitem" onClick={() => mute("off")}>
          Unmute thread
        </button>
      )}
      {[
        ["15 minutes", 15 * 60000],
        ["1 hour", 3600000],
        ["8 hours", 8 * 3600000],
        ["24 hours", 24 * 3600000],
        ["Until I unmute", null],
      ].map(([label, duration]) => (
        <button
          role="menuitem"
          key={label}
          onClick={() => mute(duration as number | null)}
        >
          {label}
        </button>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
