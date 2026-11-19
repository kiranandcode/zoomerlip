import { narrow, request } from "./api";
import type {
  Account,
  Message,
  Reaction,
  Topic,
  View,
  ZulipEvent,
} from "./types";

export const CACHE_TTL = 60_000;
const MAX_VIEWS = 24;
const MAX_MESSAGES = 300;
export type MessageSnapshot = {
  messages: Message[];
  loading: boolean;
  error: string;
  hasOlder: boolean;
  updatedAt: number;
  stale: boolean;
};
type Entry = {
  ui: { text: string; topic: string; scrollTop: number; atBottom: boolean };
  view: View;
  snapshot: MessageSnapshot;
  listeners: Set<() => void>;
  pending?: Promise<void>;
  controller?: AbortController;
};
export function matchesView(message: Message, view: View, me: number): boolean {
  if (view.type === "profile")
    return (
      message.sender_id === view.userId &&
      (view.posts === "all" || message.type === "stream")
    );
  if (view.type === "channel")
    return (
      message.type === "stream" &&
      message.stream_id === view.channelId &&
      (view.topic === undefined ||
        message.subject.toLowerCase() === view.topic.toLowerCase())
    );
  if (message.type !== "private") return false;
  if (view.type === "home") return true;
  if (!Array.isArray(message.display_recipient)) return false;
  const ids = [...new Set([...view.userIds, me])].sort((a, b) => a - b);
  return (
    message.display_recipient
      .map((u) => u.id)
      .sort((a, b) => a - b)
      .join(",") === ids.join(",")
  );
}
export function applyMessageEvent(
  messages: Message[],
  event: ZulipEvent,
  view: View,
  me: number,
): Message[] {
  if (
    event.type === "message" &&
    event.message &&
    matchesView(event.message, view, me)
  ) {
    const message = {
      ...event.message,
      reactions: event.message.reactions || [],
    };
    if (messages.some((m) => m.id === message.id)) return messages;
    return [...messages, message].sort((a, b) => a.id - b.id);
  }
  const ids = Array.isArray(event.message_ids)
    ? (event.message_ids as number[])
    : [event.message_id as number];
  if (!messages.some((m) => ids.includes(m.id))) return messages;
  if (event.type === "delete_message")
    return messages.filter((m) => !ids.includes(m.id));
  if (event.type === "reaction")
    return messages.map((m) => {
      if (m.id !== event.message_id) return m;
      const r = {
        emoji_name: event.emoji_name,
        emoji_code: event.emoji_code,
        reaction_type: event.reaction_type,
        user_id: event.user_id,
      } as Reaction;
      const without = m.reactions.filter(
        (old) =>
          !(
            old.user_id === r.user_id &&
            old.emoji_code === r.emoji_code &&
            old.reaction_type === r.reaction_type
          ),
      );
      return {
        ...m,
        reactions: event.op === "add" ? [...without, r] : without,
      };
    });
  if (event.type === "update_message")
    return messages
      .map((m) => {
        if (!ids.includes(m.id)) return m;
        return {
          ...m,
          ...(typeof event.rendered_content === "string" &&
          m.id === event.message_id
            ? {
                content: event.rendered_content,
                rendered_content: event.rendered_content,
              }
            : {}),
          ...(typeof event.subject === "string"
            ? { subject: event.subject }
            : {}),
          ...(typeof event.new_stream_id === "number"
            ? { stream_id: event.new_stream_id }
            : {}),
        };
      })
      .filter((m) => matchesView(m, view, me));
  return messages;
}

/** Bounded, account-scoped memory cache. Never stores API keys or signed URLs on disk. */
export class OrgCache {
  private entries = new Map<string, Entry>();
  private journal: { seq: number; event: ZulipEvent }[] = [];
  private sequence = 0;
  private topicData = new Map<number, { topics: Topic[]; time: number }>();
  private topicPending = new Map<number, Promise<Topic[]>>();
  private topicListeners = new Set<() => void>();
  private topicVersion = 0;
  private controllers = new Set<AbortController>();
  constructor(private account: Account) {}
  entry(view: View): Entry {
    const key = JSON.stringify(view);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        view,
        ui: {
          text: "",
          topic: view.type === "channel" ? view.topic || "" : "",
          scrollTop: 0,
          atBottom: true,
        },
        snapshot: {
          messages: [],
          loading: false,
          error: "",
          hasOlder: false,
          updatedAt: 0,
          stale: true,
        },
        listeners: new Set(),
      };
      this.entries.set(key, entry);
    }
    for (const [k, e] of this.entries)
      if (
        this.entries.size > MAX_VIEWS &&
        e.listeners.size === 0 &&
        k !== key
      ) {
        e.controller?.abort();
        this.entries.delete(k);
      }
    return entry;
  }
  subscribe(view: View, listener: () => void) {
    const e = this.entry(view);
    e.listeners.add(listener);
    return () => {
      e.listeners.delete(listener);
    };
  }
  ui(view: View) {
    return this.entry(view).ui;
  }
  snapshot(view: View) {
    return this.entry(view).snapshot;
  }
  private publish(entry: Entry, patch: Partial<MessageSnapshot>) {
    entry.snapshot = { ...entry.snapshot, ...patch };
    entry.listeners.forEach((fn) => fn());
  }
  load(view: View, force = false): Promise<void> {
    const e = this.entry(view);
    const key = JSON.stringify(view);
    this.entries.delete(key);
    this.entries.set(key, e);
    if (e.pending && !force) return e.pending;
    if (e.pending) {
      e.controller?.abort();
      e.pending = undefined;
    }
    if (
      !force &&
      !e.snapshot.stale &&
      Date.now() - e.snapshot.updatedAt < CACHE_TTL
    )
      return Promise.resolve();
    const controller = new AbortController();
    e.controller = controller;
    const started = this.sequence;
    this.publish(e, { loading: true, error: "" });
    e.pending = (async () => {
      try {
        const data = await request<{
          messages: Message[];
          found_oldest: boolean;
        }>(
          this.account,
          "/messages",
          {
            anchor: "newest",
            num_before: 60,
            num_after: 0,
            narrow: narrow(view),
            apply_markdown: true,
          },
          "GET",
          controller.signal,
        );
        let messages = data.messages;
        for (const item of this.journal)
          if (item.seq > started)
            messages = applyMessageEvent(
              messages,
              item.event,
              view,
              this.account.userId,
            );
        if (controller.signal.aborted) return;
        this.publish(e, {
          messages,
          hasOlder: !data.found_oldest,
          updatedAt: Date.now(),
          loading: false,
          stale: false,
        });
      } catch (error) {
        if (!controller.signal.aborted)
          this.publish(e, {
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not load messages.",
          });
      } finally {
        if (e.controller === controller) e.pending = undefined;
      }
    })();
    return e.pending;
  }
  async older(view: View) {
    const e = this.entry(view);
    if (e.pending) await e.pending;
    const first = e.snapshot.messages[0];
    if (!first) return;
    const controller = new AbortController();
    this.controllers.add(controller);
    const started = this.sequence;
    try {
      const data = await request<{
        messages: Message[];
        found_oldest: boolean;
      }>(
        this.account,
        "/messages",
        {
          anchor: first.id,
          include_anchor: false,
          num_before: 60,
          num_after: 0,
          narrow: narrow(view),
          apply_markdown: true,
        },
        "GET",
        controller.signal,
      );
      let older = data.messages;
      for (const item of this.journal)
        if (item.seq > started)
          older = applyMessageEvent(
            older,
            item.event,
            view,
            this.account.userId,
          );
      const merged = [
        ...older.filter(
          (m) => !e.snapshot.messages.some((old) => old.id === m.id),
        ),
        ...e.snapshot.messages,
      ];
      this.publish(e, { messages: merged, hasOlder: !data.found_oldest });
    } finally {
      this.controllers.delete(controller);
    }
  }
  events(events: ZulipEvent[]) {
    let movedHistory = false;
    for (const event of events) {
      this.journal.push({ seq: ++this.sequence, event });
      // A move can bring a known message into another cached conversation.
      const moved =
        event.type === "update_message" &&
        (event.subject !== undefined || event.new_stream_id !== undefined);
      movedHistory ||= moved;
      const known = moved
        ? [
            ...new Map(
              [...this.entries.values()]
                .flatMap((e) => e.snapshot.messages)
                .map((m) => [m.id, m]),
            ).values(),
          ]
        : [];
      for (const entry of [...this.entries.values()]) {
        let messages = applyMessageEvent(
          entry.snapshot.messages,
          event,
          entry.view,
          this.account.userId,
        );
        if (moved)
          for (const m of known) {
            const updated = applyMessageEvent(
              [m],
              event,
              { type: "profile", userId: m.sender_id, posts: "all" },
              this.account.userId,
            )[0];
            if (
              updated &&
              updated !== m &&
              matchesView(updated, entry.view, this.account.userId)
            )
              messages = applyMessageEvent(
                messages,
                { id: event.id, type: "message", message: updated },
                entry.view,
                this.account.userId,
              );
          }
        if (messages !== entry.snapshot.messages) {
          const trimmed =
            entry.listeners.size === 0 && messages.length > MAX_MESSAGES;
          this.publish(entry, {
            messages: trimmed ? messages.slice(-MAX_MESSAGES) : messages,
            hasOlder: trimmed || entry.snapshot.hasOlder,
          });
        }
      }
      if (
        event.type === "message" &&
        event.message?.type === "stream" &&
        event.message.stream_id
      ) {
        const m = event.message,
          id = m.stream_id!;
        const cached = this.topicData.get(id);
        if (cached) {
          cached.topics = [
            { name: m.subject, max_id: m.id },
            ...cached.topics.filter(
              (t) => t.name.toLowerCase() !== m.subject.toLowerCase(),
            ),
          ];
          this.notifyTopics();
        }
      }
      if (moved || event.type === "delete_message") {
        // Moves/deletions can remove the last message in a topic.
        for (const [id, value] of this.topicData)
          if (
            event.stream_id === undefined ||
            id === event.stream_id ||
            id === event.new_stream_id
          )
            value.time = 0;
        if (moved || event.type === "delete_message") this.notifyTopics();
      }
    }
    this.journal = this.journal.slice(-2000);
    if (movedHistory) {
      // A move may include messages never loaded in this client. Reconcile those
      // from the server; ordinary messages, edits and reactions need no fetch.
      for (const entry of [...this.entries.values()]) {
        this.publish(entry, { stale: true });
        if (entry.listeners.size) void this.load(entry.view, true);
      }
    }
  }
  invalidate() {
    for (const e of [...this.entries.values()]) {
      e.controller?.abort();
      e.pending = undefined;
      this.publish(e, { stale: true, loading: false });
      if (e.listeners.size) void this.load(e.view, true);
    }
    for (const topic of this.topicData.values()) topic.time = 0;
    this.notifyTopics();
  }
  peekTopics(id: number) {
    return this.topicData.get(id)?.topics;
  }
  topics(id: number): Promise<Topic[]> {
    const cached = this.topicData.get(id);
    if (cached && Date.now() - cached.time < 5 * CACHE_TTL)
      return Promise.resolve(cached.topics);
    const pending = this.topicPending.get(id);
    if (pending) return pending;
    const controller = new AbortController();
    this.controllers.add(controller);
    const started = this.sequence;
    const p = request<{ topics: Topic[] }>(
      this.account,
      `/users/me/${id}/topics`,
      {},
      "GET",
      controller.signal,
    )
      .then((data) => {
        let topics = data.topics;
        let time = Date.now();
        for (const { seq, event } of this.journal) {
          if (seq <= started) continue;
          if (event.type === "message" && event.message?.stream_id === id) {
            const m = event.message;
            topics = [
              { name: m.subject, max_id: m.id },
              ...topics.filter(
                (t) => t.name.toLowerCase() !== m.subject.toLowerCase(),
              ),
            ];
          }
          if (
            event.type === "delete_message" ||
            (event.type === "update_message" &&
              (event.subject !== undefined ||
                event.new_stream_id !== undefined))
          )
            time = 0;
        }
        this.topicData.set(id, { topics, time });
        return topics;
      })
      .finally(() => {
        this.topicPending.delete(id);
        this.controllers.delete(controller);
      });
    this.topicPending.set(id, p);
    return p;
  }
  private notifyTopics() {
    this.topicVersion++;
    this.topicListeners.forEach((fn) => fn());
  }
  subscribeTopics = (listener: () => void) => {
    this.topicListeners.add(listener);
    return () => {
      this.topicListeners.delete(listener);
    };
  };
  topicSnapshot = () => this.topicVersion;
  dispose() {
    this.entries.forEach((e) => e.controller?.abort());
    this.controllers.forEach((c) => c.abort());
    this.entries.clear();
    this.topicData.clear();
    this.journal = [];
  }
}
const caches = new Map<string, { key: string; cache: OrgCache }>();
export function getCache(account: Account) {
  let item = caches.get(account.id);
  if (!item || item.key !== account.apiKey) {
    item?.cache.dispose();
    item = { key: account.apiKey, cache: new OrgCache(account) };
    caches.set(account.id, item);
  }
  return item.cache;
}
export function clearCache(id: string) {
  caches.get(id)?.cache.dispose();
  caches.delete(id);
}
