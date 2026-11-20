import { useEffect, useLayoutEffect, useRef } from "react";
import type { Account, Channel } from "../types";
import {
  MUTE_FEATURE_LEVEL,
  setChannelMuted,
} from "../organisation/subscriptionPreferences";
import { invalidateOrganisation } from "../organisation/lifecycle";
import { useOperation } from "../organisation/useResource";

export type ChannelMenuTarget = {
  channelId: number;
  x: number;
  y: number;
  trigger: HTMLElement;
};
export function ChannelMenu({
  account,
  channel,
  target,
  featureLevel,
  onSettings,
  onClose,
}: {
  account: Account;
  channel: Channel;
  target: ChannelMenuTarget;
  featureLevel: number;
  onSettings: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const operation = useOperation();
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current!;
      const box = el.getBoundingClientRect();
      el.style.left = `${Math.max(8, Math.min(target.x, innerWidth - box.width - 8))}px`;
      el.style.top = `${Math.max(8, Math.min(target.y, innerHeight - box.height - 8))}px`;
    };
    fit();
    ref.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [target]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      if (target.trigger.isConnected)
        target.trigger.focus({ preventScroll: true });
    };
  }, [target, onClose]);
  return (
    <div
      ref={ref}
      className="topic-context-menu"
      role="menu"
      aria-label={`Channel options: ${channel.name}`}
      style={{ left: target.x, top: target.y }}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ];
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        }
      }}
    >
      <strong>{channel.name}</strong>
      <button
        role="menuitem"
        disabled={
          operation.busy ||
          featureLevel < MUTE_FEATURE_LEVEL ||
          typeof channel.is_muted !== "boolean"
        }
        onClick={() =>
          void operation.run(
            (signal) =>
              setChannelMuted(
                account,
                featureLevel,
                channel.stream_id,
                !channel.is_muted,
                signal,
              ),
            () => {
              invalidateOrganisation(account.id);
              onClose();
            },
          )
        }
      >
        {channel.is_muted ? "Unmute channel" : "Mute channel"}
      </button>
      <button
        role="menuitem"
        disabled={operation.busy}
        onClick={() => {
          onClose();
          onSettings();
        }}
      >
        Channel settings
      </button>
      {operation.busy && <small role="status">Saving…</small>}
      {operation.error && <p role="alert">{operation.error}</p>}
    </div>
  );
}
