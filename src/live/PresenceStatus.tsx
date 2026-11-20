import { useState, useSyncExternalStore } from "react";
import { request } from "../api";
import type { Account } from "../types";
import {
  availabilityLabel,
  liveStore,
  useAvailability,
  useLive,
} from "./store";

export function PresenceDot({
  account,
  userId,
}: {
  account: Account;
  userId: number;
}) {
  const label = useAvailability(account, userId);
  return (
    <span
      className="presence-dot"
      data-presence={label.toLowerCase().replaceAll(" ", "-")}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

function statusEmoji(code?: string, type?: string) {
  if (
    type !== "unicode_emoji" ||
    !code ||
    !/^[a-f0-9]{1,6}(-[a-f0-9]{1,6}){0,15}$/i.test(code)
  )
    return "";
  try {
    return String.fromCodePoint(...code.split("-").map((c) => parseInt(c, 16)));
  } catch {
    return "";
  }
}
export function PresenceStatus({
  account,
  userId,
}: {
  account: Account;
  userId: number;
}) {
  const store = liveStore(account.id);
  const snapshot = () => {
    const state = store.state,
      status = state.statuses[userId];
    return (
      availabilityLabel(state, userId, account.userId) +
      (status?.emoji_name
        ? ` · ${statusEmoji(status.emoji_code, status.reaction_type) || `:${status.emoji_name}:`}`
        : "") +
      (status?.status_text ? ` · ${status.status_text}` : "")
    );
  };
  const label = useSyncExternalStore(store.subscribe, snapshot, snapshot);
  return (
    <span className="presence-status" title={label}>
      {label}
    </span>
  );
}
const emojis = [
  { name: "", code: "", label: "No emoji" },
  { name: "calendar", code: "1f4c6", label: "📆 In a meeting" },
  { name: "palm_tree", code: "1f334", label: "🌴 Vacation" },
  { name: "working_on_it", code: "1f6e0", label: "🛠 Working" },
  { name: "headphones", code: "1f3a7", label: "🎧 Focusing" },
];
export function StatusEditor({ account }: { account: Account }) {
  const live = useLive(account),
    existing = live.statuses[account.userId];
  const [text, setText] = useState(existing?.status_text || ""),
    [emoji, setEmoji] = useState("keep"),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  async function save() {
    setBusy(true);
    setResult("");
    const store = liveStore(account.id),
      generation = store.generation;
    try {
      const choice = emojis.find((e) => e.name === emoji);
      const status = {
        status_text: text.trim(),
        ...(choice
          ? {
              emoji_name: choice.name,
              emoji_code: choice.code,
              reaction_type: "unicode_emoji",
            }
          : {}),
      };
      await request(account, "/users/me/status", status, "POST");
      if (generation !== store.generation) return;
      store.update({
        statuses: {
          ...store.state.statuses,
          [account.userId]: { ...existing, ...status },
        },
      });
      setResult("Status saved.");
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Could not save status.");
    } finally {
      setBusy(false);
    }
  }
  async function availability(enabled: boolean) {
    setBusy(true);
    setResult("");
    const store = liveStore(account.id),
      generation = store.generation;
    try {
      await request(
        account,
        "/settings",
        { presence_enabled: enabled },
        "PATCH",
      );
      if (generation === store.generation)
        store.update({
          settings: { ...store.state.settings, presence_enabled: enabled },
        });
    } catch (e) {
      setResult(
        e instanceof Error ? e.message : "Could not change availability.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!live.ready) return <p>Loading status settings…</p>;
  if (live.featureLevel < 86)
    return <p>Status editing requires Zulip feature level 86 or later.</p>;
  return (
    <details className="live-settings">
      <summary>Status and availability</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Status text
          <input value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <small>
          {[...text].length}/60 characters. Status stays until you clear it; the
          server has no expiry API.
        </small>
        <label>
          Status emoji
          <select value={emoji} onChange={(e) => setEmoji(e.target.value)}>
            <option value="keep">
              Keep current emoji
              {existing?.emoji_name ? ` (${existing.emoji_name})` : ""}
            </option>
            {emojis.map((e) => (
              <option key={e.name} value={e.name}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy || [...text.trim()].length > 60}>
          Save status
        </button>
      </form>
      <label>
        <input
          type="checkbox"
          checked={live.settings.presence_enabled !== false}
          disabled={busy}
          onChange={(e) => void availability(e.target.checked)}
        />
        Share online availability
      </label>
      {result && <p role="status">{result}</p>}
      {live.error && <p role="status">{live.error}</p>}
    </details>
  );
}
