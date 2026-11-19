import { useSyncExternalStore } from "react";
import type { Account, Channel, User, View, ZulipEvent } from "../types";

export type UserStatus = {
  status_text?: string;
  emoji_name?: string;
  emoji_code?: string;
  reaction_type?: string;
};
export type Presence = { active_timestamp?: number; idle_timestamp?: number };
export type LiveState = {
  channels: Channel[];
  names: Record<string, string>;
  followed: string[];
  ready: boolean;
  featureLevel: number;
  typing: { key: string; user: number; until: number }[];
  presences: Record<string, Presence>;
  statuses: Record<string, UserStatus>;
  settings: Record<string, unknown>;
  startMs: number;
  stopMs: number;
  expiryMs: number;
  offlineMs: number;
  error: string;
};
export const emptyLive: LiveState = {
  channels: [],
  names: {},
  followed: [],
  ready: false,
  featureLevel: 0,
  typing: [],
  presences: {},
  statuses: {},
  settings: {},
  startMs: 10000,
  stopMs: 5000,
  expiryMs: 15000,
  offlineMs: 140000,
  error: "",
};
const stores = new Map<string, LiveStore>();
export class LiveStore {
  state: LiveState = emptyLive;
  listeners = new Set<() => void>();
  generation = 0;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.state;
  update(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  clear() {
    this.generation++;
    this.state = emptyLive;
    this.listeners.forEach((fn) => fn());
  }
  register(data: Record<string, unknown>) {
    this.clear();
    const period = (key: string, fallback: number) =>
      typeof data[key] === "number"
        ? Math.min(300000, Math.max(1000, data[key] as number))
        : fallback;
    this.update({
      channels: (data.subscriptions || []) as Channel[],
      names: Object.fromEntries(
        ((data.realm_users || []) as User[])
          .slice(0, 10000)
          .map((u) => [u.user_id, u.full_name]),
      ),
      followed: (
        (data.user_topics || []) as {
          stream_id: number;
          topic_name: string;
          visibility_policy: number;
        }[]
      )
        .filter((t) => t.visibility_policy === 3)
        .slice(-10000)
        .map((t) => JSON.stringify([t.stream_id, t.topic_name.toLowerCase()])),
      ready: true,
      featureLevel: Number(data.zulip_feature_level) || 0,
      statuses: boundedRecord(data.user_status),
      settings: { ...(data.user_settings as object) },
      startMs: period("server_typing_started_wait_period_milliseconds", 10000),
      stopMs: period("server_typing_stopped_wait_period_milliseconds", 5000),
      expiryMs: period(
        "server_typing_started_expiry_period_milliseconds",
        15000,
      ),
      offlineMs:
        typeof data.server_presence_offline_threshold_seconds === "number"
          ? data.server_presence_offline_threshold_seconds * 1000
          : 140000,
    });
    // Older registrations expose user settings at the top level.
    const settings = { ...this.state.settings };
    for (const key of settingKeys)
      if (data[key] !== undefined) settings[key] = data[key];
    this.update({ settings });
  }
  events(events: ZulipEvent[], account: Account) {
    for (const e of events) {
      if (e.type === "realm_user") {
        const person = e.person as User;
        if (person?.user_id) {
          const names = { ...this.state.names };
          if (e.op === "remove") delete names[person.user_id];
          else if (person.full_name) names[person.user_id] = person.full_name;
          this.update({ names });
        }
      }
      if (e.type === "user_topic") {
        const key = JSON.stringify([
          e.stream_id,
          String(e.topic_name).toLowerCase(),
        ]);
        this.update({
          followed: [
            ...this.state.followed.filter((t) => t !== key),
            ...(e.visibility_policy === 3 ? [key] : []),
          ].slice(-10000),
        });
      }
      if (
        ["subscription", "stream", "realm_user"].includes(e.type) &&
        ["remove", "delete"].includes(String(e.op))
      ) {
        this.generation++;
        this.update({ typing: [], presences: {}, statuses: {} });
      } else if (e.type === "typing") {
        const sender = e.sender as { user_id?: number } | undefined;
        if (!sender?.user_id || sender.user_id === account.userId) continue;
        const key =
          e.message_type === "stream"
            ? conversationKey(
                {
                  type: "channel",
                  channelId: Number(e.stream_id),
                  topic: String(e.topic ?? ""),
                },
                account.userId,
              )
            : conversationKey(
                {
                  type: "dm",
                  userIds: ((e.recipients || []) as { user_id: number }[]).map(
                    (r) => r.user_id,
                  ),
                },
                account.userId,
              );
        const typing = this.state.typing.filter(
          (t) =>
            t.until > Date.now() &&
            !(t.key === key && t.user === sender.user_id),
        );
        if (e.op === "start")
          typing.push({
            key,
            user: sender.user_id,
            until: Date.now() + this.state.expiryMs,
          });
        this.update({ typing: typing.slice(-256) });
      } else if (e.type === "user_status" && typeof e.user_id === "number") {
        const status = { ...this.state.statuses[e.user_id] };
        for (const k of [
          "status_text",
          "emoji_name",
          "emoji_code",
          "reaction_type",
        ] as const)
          if (typeof e[k] === "string") status[k] = e[k];
        this.update({
          statuses: boundedRecord({
            ...this.state.statuses,
            [e.user_id]: status,
          }),
        });
      } else if (e.type === "presence") {
        if (e.presences) this.mergePresence(e.presences);
        else if (typeof e.user_id === "number") {
          const p = (
            e.presence as Record<string, { status: string; timestamp: number }>
          )?.aggregated;
          if (p)
            this.mergePresence({
              [e.user_id]: {
                [p.status === "active" ? "active_timestamp" : "idle_timestamp"]:
                  p.timestamp,
              },
            });
        }
      } else if (
        (e.type === "user_settings" ||
          e.type === "update_global_notifications") &&
        typeof e.property === "string"
      ) {
        this.update({
          settings: {
            ...this.state.settings,
            [e.property]: e.value ?? e.setting,
          },
        });
      }
    }
  }
  mergePresence(value: unknown) {
    this.update({
      presences: boundedRecord({
        ...this.state.presences,
        ...boundedRecord(value),
      }),
    });
  }
  expire(now = Date.now()) {
    const typing = this.state.typing.filter((t) => t.until > now);
    const presences = Object.fromEntries(
      Object.entries(this.state.presences).filter(
        ([, p]) =>
          Math.max(p.active_timestamp || 0, p.idle_timestamp || 0) * 1000 +
            this.state.offlineMs >
          now,
      ),
    );
    if (
      typing.length !== this.state.typing.length ||
      Object.keys(presences).length !== Object.keys(this.state.presences).length
    )
      this.update({ typing, presences });
  }
}
const settingKeys = [
  "presence_enabled",
  "send_private_typing_notifications",
  "send_stream_typing_notifications",
  "send_read_receipts",
  "enable_desktop_notifications",
  "enable_sounds",
  "enable_stream_desktop_notifications",
  "enable_stream_sounds",
  "enable_followed_topic_desktop_notifications",
  "enable_followed_topic_audible_notifications",
  "enable_followed_topic_wildcard_mentions_notify",
  "pm_content_in_desktop_notifications",
  "wildcard_mentions_notify",
  "realm_enable_read_receipts",
];
function boundedRecord<T>(value: unknown): Record<string, T> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).slice(-10000))
    : {};
}
export function liveStore(id: string) {
  let s = stores.get(id);
  if (!s) {
    s = new LiveStore();
    stores.set(id, s);
  }
  return s;
}
export function releaseLive(id: string) {
  const s = stores.get(id);
  s?.clear();
  if (!s?.listeners.size) stores.delete(id);
}
export function useLive(account: Account) {
  const s = liveStore(account.id);
  return useSyncExternalStore(s.subscribe, s.snapshot, s.snapshot);
}
export function conversationKey(view: View, me: number): string {
  if (view.type === "channel")
    return JSON.stringify([view.channelId, (view.topic ?? "").toLowerCase()]);
  if (view.type === "dm")
    return JSON.stringify(
      [...new Set([...view.userIds, me])].sort((a, b) => a - b),
    );
  return "";
}
export function presenceLabel(
  state: LiveState,
  user: number,
  now = Date.now(),
) {
  const p = state.presences[user];
  if ((p?.active_timestamp || 0) * 1000 + state.offlineMs > now)
    return "Online";
  if ((p?.idle_timestamp || 0) * 1000 + state.offlineMs > now) return "Idle";
  return "Offline";
}
