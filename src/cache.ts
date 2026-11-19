import { clearContentCache } from "./contentCache";
import { ApiError, getFeatureLevel, narrow, request } from "./api";
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
/** Upper bound for a view that is on screen; pagination slides this window. */
export const MAX_ACTIVE_MESSAGES = 600;
const MAX_JOURNAL = 2000;
const PAGE = 60;
export type MessageSnapshot = {
  messages: Message[];
  loading: boolean;
  error: string;
  hasOlder: boolean;
  /** The window ends before the newest message; live messages are not appended. */
  hasNewer: boolean;
  updatedAt: number;
  stale: boolean;
};
type Entry = {
  ui: {
    text: string;
    topic: string;
    scrollTop: number;
    /** The reader is at the live end: the newest message is in view. */
    atBottom: boolean;
    /** The first message in view while reading history, for revalidation. */
    anchorId?: number;
    /** Its offset from the scroller's top, retained across navigation. */
    anchorTop?: number;
  };
  view: View;
  snapshot: MessageSnapshot;
  listeners: Set<() => void>;
  version: number;
  pending?: Promise<void>;
  controller?: AbortController;
  olderPending?: Promise<void>;
  olderController?: AbortController;
  newerPending?: Promise<void>;
  newerController?: AbortController;
  /** Oldest and newest server IDs fetched, including messages filtered out. */
  oldest?: number;
  newest?: number;
};
type Flight = {
  controller: AbortController;
  generation: number;
  started: number;
};
type TopicFlight = Flight & { revision: number; promise: Promise<Topic[]> };
const emptySnapshot = (): MessageSnapshot => ({
  messages: [],
  loading: false,
  error: "",
  hasOlder: false,
  hasNewer: false,
  updatedAt: 0,
  stale: true,
});
function idBounds(messages: Message[]): [number, number] | undefined {
  if (!messages.length) return undefined;
  let low = messages[0].id,
    high = low;
  for (const m of messages) {
    low = Math.min(low, m.id);
    high = Math.max(high, m.id);
  }
  return [low, high];
}
const sameTopic = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const viewKey = (view: View) => JSON.stringify(view);
const messageIds = (event: ZulipEvent) =>
  new Set(
    Array.isArray(event.message_ids)
      ? (event.message_ids as number[])
      : typeof event.message_id === "number"
        ? [event.message_id]
        : [],
  );
const isMove = (event: ZulipEvent) =>
  event.type === "update_message" &&
  (event.subject !== undefined || event.new_stream_id !== undefined);

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
      (view.topic === undefined || sameTopic(message.subject, view.topic))
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
function editedMessage(message: Message, event: ZulipEvent): Message {
  return {
    ...message,
    ...(typeof event.rendered_content === "string" &&
    message.id === event.message_id
      ? {
          content: event.rendered_content,
          rendered_content: event.rendered_content,
        }
      : {}),
    ...(typeof event.subject === "string" ? { subject: event.subject } : {}),
    ...(typeof event.new_stream_id === "number"
      ? { stream_id: event.new_stream_id }
      : {}),
    ...(Array.isArray(event.flags) && message.id === event.message_id
      ? { flags: event.flags as string[] }
      : {}),
  };
}
export function applyMessageEvent(
  messages: Message[],
  event: ZulipEvent,
  view: View,
  me: number,
  ids = messageIds(event),
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
    // Events normally arrive in increasing message order. Avoid sorting that path.
    if (!messages.length || messages[messages.length - 1].id < message.id)
      return [...messages, message];
    if (messages.some((m) => m.id === message.id)) return messages;
    return [...messages, message].sort((a, b) => a.id - b.id);
  }
  if (!messages.some((m) => ids.has(m.id))) return messages;
  if (event.type === "delete_message")
    return messages.filter((m) => !ids.has(m.id));
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
      .map((m) => (ids.has(m.id) ? editedMessage(m, event) : m))
      .filter((m) => matchesView(m, view, me));
  return messages;
}

/** Account-scoped memory only. Every asynchronous write checks its generation. */
export class OrgCache {
  private entries = new Map<string, Entry>();
  private journal: { seq: number; event: ZulipEvent }[] = [];
  private sequence = 0;
  private generation = 0;
  private locked = false;
  private mutedUsers = new Set<number>();
  private blockedStreams = new Set<number>();
  private topicData = new Map<number, { topics: Topic[]; time: number }>();
  private topicPending = new Map<number, TopicFlight>();
  private topicRevisions = new Map<number, number>();
  private topicListeners = new Set<() => void>();
  private topicVersion = 0;
  private navigationListeners = new Set<() => void>();
  private navigationVersion = 0;
  private moves: {
    from: Extract<View, { type: "channel" }>;
    to: Extract<View, { type: "channel" }>;
  }[] = [];
  constructor(private account: Account) {}
  private allowed(view: View) {
    return (
      !this.locked &&
      !(view.type === "channel" && this.blockedStreams.has(view.channelId)) &&
      !(view.type === "profile" && this.mutedUsers.has(view.userId))
    );
  }
  private visible(message: Message) {
    return (
      !this.locked &&
      !this.mutedUsers.has(message.sender_id) &&
      !(
        message.stream_id !== undefined &&
        this.blockedStreams.has(message.stream_id)
      )
    );
  }
  private filter(messages: Message[]) {
    return messages.filter((m) => this.visible(m));
  }
  private current(flight: Flight) {
    return (
      !flight.controller.signal.aborted &&
      flight.generation === this.generation &&
      !this.locked
    );
  }
  private replayAvailable(started: number) {
    return started >= this.sequence - this.journal.length;
  }
  private replay(
    messages: Message[],
    started: number,
    view: View,
    min: number,
    max: number,
  ) {
    for (const item of this.journal)
      if (item.seq > started)
        messages = applyMessageEvent(
          messages,
          item.event,
          view,
          this.account.userId,
        );
    // Events outside the fetched interval are separated by an unfetched gap.
    // A live-tail response may extend through Infinity; a history page may not.
    return messages.filter(
      (m) => m.id >= min && m.id <= max && this.visible(m),
    );
  }
  private cancelEntry(e: Entry) {
    e.version++;
    e.controller?.abort();
    e.olderController?.abort();
    e.newerController?.abort();
    e.pending = undefined;
    e.olderPending = undefined;
    e.newerPending = undefined;
  }
  private cancelRequests() {
    this.generation++;
    for (const e of this.entries.values()) this.cancelEntry(e);
    for (const flight of this.topicPending.values()) flight.controller.abort();
    this.topicPending.clear();
    this.journal = [];
  }
  private trim(e: Entry, keep?: "newest" | "oldest") {
    const { messages } = e.snapshot;
    if (!e.listeners.size) {
      if (messages.length <= MAX_MESSAGES) return;
      // Keep a bounded interval around the reader, not a different live tail.
      // The saved row offset lets the UI restore after rows before it are cut.
      const anchor = e.ui.atBottom
          ? -1
          : messages.findIndex((m) => m.id === e.ui.anchorId),
        start =
          anchor < 0
            ? messages.length - MAX_MESSAGES
            : Math.max(
                0,
                Math.min(
                  messages.length - MAX_MESSAGES,
                  anchor - Math.floor(MAX_MESSAGES / 2),
                ),
              ),
        kept = messages.slice(start, start + MAX_MESSAGES),
        droppedNewer = start + MAX_MESSAGES < messages.length;
      e.snapshot = {
        ...e.snapshot,
        messages: kept,
        hasOlder: e.snapshot.hasOlder || start > 0,
        hasNewer: e.snapshot.hasNewer || droppedNewer,
      };
      if (start > 0) e.oldest = kept[0].id;
      if (droppedNewer) e.newest = kept[kept.length - 1].id;
      return;
    }
    if (messages.length <= MAX_ACTIVE_MESSAGES) return;
    keep ??= e.view.type === "home" || e.ui.atBottom ? "newest" : "oldest";
    // Keep the edge the reader is looking at; the other edge becomes pageable.
    if (keep === "newest") {
      const kept = messages.slice(-MAX_ACTIVE_MESSAGES);
      e.oldest = kept[0].id;
      e.snapshot = { ...e.snapshot, messages: kept, hasOlder: true };
    } else {
      const kept = messages.slice(0, MAX_ACTIVE_MESSAGES);
      e.newest = kept[kept.length - 1].id;
      e.snapshot = { ...e.snapshot, messages: kept, hasNewer: true };
    }
  }
  entry(view: View): Entry {
    const key = viewKey(view);
    let e = this.entries.get(key);
    if (!e) {
      e = {
        view,
        ui: {
          text: "",
          topic: view.type === "channel" ? view.topic || "" : "",
          scrollTop: 0,
          atBottom: true,
        },
        snapshot: emptySnapshot(),
        listeners: new Set(),
        version: 0,
      };
      this.entries.set(key, e);
    }
    for (const [k, entry] of this.entries)
      if (this.entries.size > MAX_VIEWS && !entry.listeners.size && k !== key) {
        this.cancelEntry(entry);
        this.entries.delete(k);
      }
    return e;
  }
  subscribe(view: View, listener: () => void) {
    const e = this.entry(view);
    e.listeners.add(listener);
    return () => {
      e.listeners.delete(listener);
      this.trim(e);
    };
  }
  ui(view: View) {
    return this.entry(view).ui;
  }
  snapshot(view: View) {
    return this.entry(view).snapshot;
  }
  private publish(
    e: Entry,
    patch: Partial<MessageSnapshot>,
    keep?: "newest" | "oldest",
  ) {
    e.snapshot = { ...e.snapshot, ...patch };
    this.trim(e, keep);
    for (const fn of e.listeners) fn();
  }
  private clearEntry(e: Entry, error = "") {
    this.cancelEntry(e);
    e.ui.text = "";
    e.ui.topic = e.view.type === "channel" ? e.view.topic || "" : "";
    e.ui.scrollTop = 0;
    e.ui.atBottom = true;
    e.ui.anchorId = undefined;
    e.ui.anchorTop = undefined;
    e.oldest = e.newest = undefined;
    this.publish(e, { ...emptySnapshot(), error });
  }
  private denied(error: unknown, view: View): boolean {
    if (!(error instanceof ApiError)) return false;
    if (error.status === 401) {
      this.lock();
      return true;
    }
    if (
      error.status === 403 ||
      error.status === 404 ||
      (view.type === "channel" && error.status === 400)
    ) {
      if (view.type === "channel") this.purgeStreams([view.channelId]);
      else {
        this.cancelRequests();
        for (const e of this.entries.values()) this.clearEntry(e);
        this.topicData.clear();
        this.notifyTopics();
      }
      return true;
    }
    return false;
  }
  load(view: View, force = false): Promise<void> {
    const e = this.entry(view),
      key = viewKey(view);
    if (!this.allowed(view)) {
      this.clearEntry(e);
      return Promise.resolve();
    }
    this.entries.delete(key);
    this.entries.set(key, e);
    if (e.pending && !force) return e.pending;
    if (
      !force &&
      !e.snapshot.stale &&
      Date.now() - e.snapshot.updatedAt < CACHE_TTL
    )
      return Promise.resolve();
    this.cancelEntry(e);
    const version = e.version;
    const flight: Flight = {
      controller: new AbortController(),
      generation: this.generation,
      started: this.sequence,
    };
    e.controller = flight.controller;
    this.publish(e, { loading: true, error: "" });
    const valid = () =>
      this.current(flight) &&
      e.version === version &&
      this.entries.get(key) === e;
    // Revalidate the range being read, not just the newest page. The response
    // replaces the retained messages, so deleted or revoked content is dropped.
    const retained = e.snapshot.messages,
      anchorId = e.ui.anchorId,
      at =
        !e.ui.atBottom && anchorId !== undefined && view.type !== "home"
          ? retained.findIndex((m) => m.id === anchorId)
          : -1,
      span = (n: number, most: number) => Math.min(Math.max(n, PAGE), most);
    const range =
      at >= 0
        ? {
            anchor: anchorId!,
            num_before: span(at, MAX_ACTIVE_MESSAGES / 2),
            num_after: span(retained.length - at - 1, MAX_ACTIVE_MESSAGES / 2),
          }
        : {
            anchor: "newest",
            num_before: span(retained.length, MAX_MESSAGES),
            num_after: 0,
          };
    e.pending = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          flight.started = this.sequence;
          const data = await request<{
            messages: Message[];
            found_oldest: boolean;
            found_newest?: boolean;
          }>(
            this.account,
            "/messages",
            {
              ...range,
              narrow: narrow(view, getFeatureLevel(this.account.url)),
              apply_markdown: true,
            },
            "GET",
            flight.controller.signal,
          );
          if (!valid()) return;
          // Never apply a response if its replay window has been discarded.
          if (!this.replayAvailable(flight.started)) continue;
          const bounds = idBounds(data.messages),
            hasNewer = at >= 0 && data.found_newest === false;
          const messages = this.replay(
            data.messages,
            flight.started,
            view,
            data.found_oldest
              ? -Infinity
              : (bounds?.[0] ?? anchorId ?? Infinity),
            hasNewer ? (bounds?.[1] ?? anchorId!) : Infinity,
          );
          e.oldest = bounds?.[0];
          e.newest = bounds?.[1];
          this.publish(
            e,
            {
              messages,
              hasOlder: !data.found_oldest,
              hasNewer,
              updatedAt: Date.now(),
              loading: false,
              stale: false,
            },
            at >= 0 ? undefined : "newest",
          );
          return;
        }
        throw new Error(
          "Messages changed too quickly to reconcile. Reload this view.",
        );
      } catch (error) {
        if (valid()) {
          const accessDenied = this.denied(error, view);
          this.publish(e, {
            loading: false,
            stale: true,
            error:
              error instanceof Error
                ? error.message
                : "Could not load messages.",
            ...(accessDenied
              ? { messages: [], hasOlder: false, hasNewer: false }
              : {}),
          });
        }
      } finally {
        if (e.controller === flight.controller) e.pending = undefined;
      }
    })();
    return e.pending;
  }
  async older(view: View): Promise<void> {
    const e = this.entry(view);
    if (!this.allowed(view)) return;
    if (e.pending) await e.pending;
    if (e.olderPending) return e.olderPending;
    // Page from the server's cursor: muted messages never reach the display list.
    const cursor = () => e.oldest ?? e.snapshot.messages[0]?.id;
    const start = cursor();
    if (start === undefined || !this.allowed(view)) return;
    const version = e.version,
      key = viewKey(view);
    const flight: Flight = {
      controller: new AbortController(),
      generation: this.generation,
      started: this.sequence,
    };
    e.olderController = flight.controller;
    const valid = () =>
      this.current(flight) &&
      e.version === version &&
      this.entries.get(key) === e &&
      cursor() === start;
    e.olderPending = (async () => {
      try {
        let anchor = start,
          foundOldest = false;
        const older: Message[] = [];
        // Pages that hold only muted messages are skipped, within a bound.
        for (let page = 0; page < 5; page++) {
          const data = await request<{
            messages: Message[];
            found_oldest: boolean;
          }>(
            this.account,
            "/messages",
            {
              anchor,
              include_anchor: false,
              num_before: PAGE,
              num_after: 0,
              narrow: narrow(view, getFeatureLevel(this.account.url)),
              apply_markdown: true,
            },
            "GET",
            flight.controller.signal,
          );
          if (!valid()) return;
          if (!this.replayAvailable(flight.started)) {
            await this.load(view, true);
            return;
          }
          foundOldest = data.found_oldest;
          const bounds = idBounds(data.messages);
          older.unshift(
            ...this.replay(
              data.messages,
              flight.started,
              view,
              foundOldest ? -Infinity : (bounds?.[0] ?? anchor),
              anchor - 1,
            ),
          );
          if (bounds) anchor = bounds[0];
          if (foundOldest || older.length || !bounds) break;
        }
        const known = new Set(e.snapshot.messages.map((m) => m.id));
        const merged = [
          ...older.filter((m) => !known.has(m.id)),
          ...e.snapshot.messages,
        ].sort((a, b) => a.id - b.id);
        e.oldest = anchor;
        // The reader is at the top, so an oversized window drops its newest end.
        this.publish(e, { messages: merged, hasOlder: !foundOldest }, "oldest");
      } catch (error) {
        if (valid()) {
          this.denied(error, view);
          throw error;
        }
      } finally {
        if (e.olderController === flight.controller) e.olderPending = undefined;
      }
    })();
    return e.olderPending;
  }
  /** Pages forward from a window that ends before the newest message. */
  async newer(view: View): Promise<void> {
    const e = this.entry(view);
    if (!this.allowed(view)) return;
    if (e.pending) await e.pending;
    if (e.newerPending) return e.newerPending;
    const cursor = () => e.newest ?? e.snapshot.messages.at(-1)?.id;
    const start = cursor();
    if (start === undefined || !e.snapshot.hasNewer || !this.allowed(view))
      return;
    const version = e.version,
      key = viewKey(view);
    const flight: Flight = {
      controller: new AbortController(),
      generation: this.generation,
      started: this.sequence,
    };
    e.newerController = flight.controller;
    const valid = () =>
      this.current(flight) &&
      e.version === version &&
      this.entries.get(key) === e &&
      cursor() === start;
    e.newerPending = (async () => {
      try {
        let anchor = start,
          foundNewest = false;
        const newer: Message[] = [];
        for (let page = 0; page < 5; page++) {
          const data = await request<{
            messages: Message[];
            found_newest: boolean;
          }>(
            this.account,
            "/messages",
            {
              anchor,
              include_anchor: false,
              num_before: 0,
              num_after: PAGE,
              narrow: narrow(view, getFeatureLevel(this.account.url)),
              apply_markdown: true,
            },
            "GET",
            flight.controller.signal,
          );
          if (!valid()) return;
          if (!this.replayAvailable(flight.started)) {
            await this.load(view, true);
            return;
          }
          const bounds = idBounds(data.messages);
          foundNewest = data.found_newest;
          const page = this.replay(
            data.messages,
            flight.started,
            view,
            anchor + 1,
            foundNewest ? Infinity : (bounds?.[1] ?? anchor),
          );
          if (bounds) anchor = bounds[1];
          newer.push(...page);
          if (foundNewest || newer.length || !bounds) break;
        }
        const known = new Set(e.snapshot.messages.map((m) => m.id));
        const merged = [
          ...e.snapshot.messages,
          ...newer.filter((m) => !known.has(m.id)),
        ].sort((a, b) => a.id - b.id);
        e.newest = anchor;
        // The reader is at the live end, so an oversized window drops its oldest end.
        this.publish(e, { messages: merged, hasNewer: !foundNewest }, "newest");
      } catch (error) {
        if (valid()) {
          this.denied(error, view);
          throw error;
        }
      } finally {
        if (e.newerController === flight.controller) e.newerPending = undefined;
      }
    })();
    return e.newerPending;
  }
  events(events: ZulipEvent[]) {
    if (this.locked) return;
    const me = this.account.userId;
    // Each view's messages are rebuilt once per batch and published once.
    const work = new Map<Entry, Message[]>();
    const messagesOf = (entry: Entry) =>
      work.get(entry) ?? entry.snapshot.messages;
    const moves: ZulipEvent[] = [];
    for (const event of events) {
      this.journal.push({ seq: ++this.sequence, event });
      const moved = isMove(event),
        ids = messageIds(event);
      if (moved) moves.push(event);
      // Transform each affected known message once, not every message per view.
      const known = new Map<number, Message>();
      if (moved)
        for (const entry of this.entries.values())
          for (const m of messagesOf(entry))
            if (ids.has(m.id) && !known.has(m.id))
              known.set(m.id, editedMessage(m, event));
      const incoming = event.type === "message" ? event.message : undefined;
      for (const entry of this.entries.values()) {
        const current = messagesOf(entry);
        // A window that ends in history must not gain messages past its end.
        const end = entry.snapshot.hasNewer
          ? (entry.newest ?? current.at(-1)?.id ?? 0)
          : Infinity;
        const start = entry.snapshot.hasOlder
          ? (entry.oldest ?? current[0]?.id ?? Infinity)
          : -Infinity;
        let messages: Message[];
        if (incoming && (incoming.id > end || incoming.id < start))
          messages = current;
        else if (
          incoming &&
          work.has(entry) &&
          (!current.length || current[current.length - 1].id < incoming.id) &&
          matchesView(incoming, entry.view, me)
        ) {
          // This batch already owns the array, so appending is O(1).
          if (this.visible(incoming))
            current.push({ ...incoming, reactions: incoming.reactions || [] });
          messages = current;
        } else
          messages = applyMessageEvent(current, event, entry.view, me, ids);
        if (moved)
          for (const message of known.values())
            if (
              message.id >= start &&
              message.id <= end &&
              this.visible(message) &&
              matchesView(message, entry.view, me)
            )
              messages = applyMessageEvent(
                messages,
                { id: event.id, type: "message", message },
                entry.view,
                me,
              );
        if (messages !== current) work.set(entry, this.filter(messages));
      }
      if (moved) this.recordMove(event);
      if (
        incoming?.type === "stream" &&
        incoming.stream_id !== undefined &&
        this.visible(incoming)
      ) {
        const id = incoming.stream_id,
          cached = this.topicData.get(id);
        if (cached) {
          cached.topics = [
            { name: incoming.subject, max_id: incoming.id },
            ...cached.topics.filter(
              (t) => !sameTopic(t.name, incoming.subject),
            ),
          ];
          this.notifyTopics();
        }
      }
      if (moved || event.type === "delete_message") {
        const channels = new Set([
          ...this.topicData.keys(),
          ...this.topicPending.keys(),
        ]);
        for (const id of channels)
          if (
            event.stream_id === undefined ||
            id === event.stream_id ||
            id === event.new_stream_id
          )
            this.invalidateTopics(id);
        this.notifyTopics();
      }
    }
    this.journal = this.journal.slice(-MAX_JOURNAL);
    // Avoid rebuilding snapshots when a batch concerns only a muted sender.
    for (const [entry, messages] of work) {
      const before = entry.snapshot.messages;
      if (
        messages.length !== before.length ||
        messages.some((m, i) => m !== before[i])
      )
        this.publish(entry, { messages });
    }
    // Moved messages may come from history no view holds. Only the source and
    // destination channels can gain them, so only those views are refetched.
    if (moves.length) {
      const channels = new Set<number>();
      let unknown = false;
      for (const event of moves) {
        if (typeof event.stream_id === "number") channels.add(event.stream_id);
        else unknown = true;
        if (typeof event.new_stream_id === "number")
          channels.add(event.new_stream_id);
      }
      for (const e of [...this.entries.values()])
        if (
          e.view.type === "channel" &&
          (unknown || channels.has(e.view.channelId))
        ) {
          this.publish(e, { stale: true });
          if (e.listeners.size) void this.load(e.view, true);
        }
    }
  }
  private invalidateTopics(id: number) {
    this.topicRevisions.set(id, (this.topicRevisions.get(id) || 0) + 1);
    const cached = this.topicData.get(id);
    if (cached) cached.time = 0;
  }
  invalidate() {
    this.cancelRequests();
    for (const e of [...this.entries.values()]) {
      this.publish(e, { stale: true, loading: false });
      if (e.listeners.size && this.allowed(e.view))
        void this.load(e.view, true);
    }
    for (const topic of this.topicData.values()) topic.time = 0;
    this.notifyTopics();
  }
  peekTopics(id: number) {
    return this.locked || this.blockedStreams.has(id)
      ? undefined
      : this.topicData.get(id)?.topics;
  }
  topics(id: number): Promise<Topic[]> {
    if (this.locked || this.blockedStreams.has(id)) return Promise.resolve([]);
    const cached = this.topicData.get(id);
    if (cached && Date.now() - cached.time < 5 * CACHE_TTL)
      return Promise.resolve(cached.topics);
    const pending = this.topicPending.get(id);
    if (pending) return pending.promise;
    const flight: TopicFlight = {
      controller: new AbortController(),
      generation: this.generation,
      started: this.sequence,
      revision: this.topicRevisions.get(id) || 0,
      promise: Promise.resolve([]),
    };
    flight.promise = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          flight.started = this.sequence;
          flight.revision = this.topicRevisions.get(id) || 0;
          const data = await request<{ topics: Topic[] }>(
            this.account,
            `/users/me/${id}/topics`,
            {},
            "GET",
            flight.controller.signal,
          );
          if (!this.current(flight))
            return this.locked || this.blockedStreams.has(id)
              ? []
              : this.topics(id);
          if (
            !this.replayAvailable(flight.started) ||
            flight.revision !== (this.topicRevisions.get(id) || 0)
          )
            continue;
          let topics = data.topics;
          for (const { seq, event } of this.journal)
            if (
              seq > flight.started &&
              event.type === "message" &&
              event.message?.stream_id === id &&
              this.visible(event.message)
            ) {
              const m = event.message;
              topics = [
                { name: m.subject, max_id: m.id },
                ...topics.filter((t) => !sameTopic(t.name, m.subject)),
              ];
            }
          this.topicData.set(id, { topics, time: Date.now() });
          return topics;
        }
        throw new Error(
          "Topics changed too quickly to reconcile. Reopen this channel.",
        );
      } catch (error) {
        if (!this.current(flight))
          return this.locked || this.blockedStreams.has(id)
            ? []
            : this.topics(id);
        this.denied(error, { type: "channel", channelId: id });
        throw error;
      } finally {
        if (this.topicPending.get(id) === flight) this.topicPending.delete(id);
      }
    })();
    this.topicPending.set(id, flight);
    return flight.promise;
  }
  setMutedUsers(ids: number[]) {
    const next = new Set(ids);
    if (
      next.size === this.mutedUsers.size &&
      [...next].every((id) => this.mutedUsers.has(id))
    )
      return;
    clearContentCache(this.account.url);
    this.mutedUsers = next;
    this.cancelRequests();
    for (const e of [...this.entries.values()]) {
      this.publish(e, {
        messages: this.filter(e.snapshot.messages),
        stale: true,
        loading: false,
      });
      if (e.view.type === "profile" && next.has(e.view.userId)) e.ui.text = "";
      if (e.listeners.size && this.allowed(e.view))
        void this.load(e.view, true);
    }
    this.notifyNavigation();
    this.notifyTopics();
  }
  purgeStreams(ids: number[]) {
    const removed = new Set(ids);
    if (!removed.size) return;
    clearContentCache(this.account.url);
    for (const id of removed) {
      this.blockedStreams.add(id);
      this.topicData.delete(id);
      this.topicRevisions.delete(id);
    }
    this.cancelRequests();
    this.moves = this.moves.filter(
      (m) => !removed.has(m.from.channelId) && !removed.has(m.to.channelId),
    );
    for (const e of this.entries.values()) {
      if (e.view.type === "channel" && removed.has(e.view.channelId))
        this.clearEntry(e);
      else
        this.publish(e, {
          messages: this.filter(e.snapshot.messages),
          loading: false,
          stale: true,
        });
    }
    this.notifyTopics();
    this.notifyNavigation();
    for (const e of [...this.entries.values()])
      if (e.listeners.size && this.allowed(e.view))
        void this.load(e.view, true);
  }
  allowStreams(ids: number[]) {
    let changed = false;
    for (const id of ids) changed = this.blockedStreams.delete(id) || changed;
    if (changed) this.notifyNavigation();
  }
  lock() {
    clearContentCache(this.account.url);
    this.locked = true;
    this.cancelRequests();
    this.topicData.clear();
    this.topicRevisions.clear();
    this.moves = [];
    for (const e of this.entries.values()) this.clearEntry(e);
    this.notifyTopics();
    this.notifyNavigation();
  }
  unlock() {
    if (this.locked) {
      this.locked = false;
      this.notifyNavigation();
    }
  }
  private recordMove(event: ZulipEvent) {
    if (
      event.propagate_mode !== "change_all" ||
      typeof event.stream_id !== "number" ||
      typeof event.orig_subject !== "string"
    )
      return;
    const from: Extract<View, { type: "channel" }> = {
      type: "channel",
      channelId: event.stream_id,
      topic: event.orig_subject,
    };
    const to: Extract<View, { type: "channel" }> = {
      type: "channel",
      channelId:
        typeof event.new_stream_id === "number"
          ? event.new_stream_id
          : from.channelId,
      topic: typeof event.subject === "string" ? event.subject : from.topic,
    };
    if (from.channelId === to.channelId && from.topic === to.topic) return;
    // Keep the unsent draft with its destination when navigation follows a rename.
    const source = this.entries.get(viewKey(from));
    if (source) {
      const target = this.entry(to);
      if (!target.ui.text) {
        target.ui.text = source.ui.text;
        target.ui.topic = to.topic || "";
      }
      if (target.ui.text === source.ui.text) source.ui.text = "";
    }
    this.moves.push({ from, to });
    this.moves = this.moves.slice(-100);
    this.notifyNavigation();
  }
  resolveView(view: View): View {
    if (!this.allowed(view)) return { type: "home" };
    let result = view;
    for (const move of this.moves)
      if (
        result.type === "channel" &&
        result.topic !== undefined &&
        result.channelId === move.from.channelId &&
        sameTopic(result.topic, move.from.topic || "")
      )
        result = move.to;
    return this.allowed(result) ? result : { type: "home" };
  }
  private notifyTopics() {
    this.topicVersion++;
    for (const fn of this.topicListeners) fn();
  }
  subscribeTopics = (listener: () => void) => {
    this.topicListeners.add(listener);
    return () => {
      this.topicListeners.delete(listener);
    };
  };
  topicSnapshot = () => this.topicVersion;
  private notifyNavigation() {
    this.navigationVersion++;
    for (const fn of this.navigationListeners) fn();
  }
  subscribeNavigation = (listener: () => void) => {
    this.navigationListeners.add(listener);
    return () => {
      this.navigationListeners.delete(listener);
    };
  };
  navigationSnapshot = () => this.navigationVersion;
  dispose() {
    this.lock();
    this.entries.clear();
    this.mutedUsers.clear();
    this.blockedStreams.clear();
  }
}
const caches = new Map<string, { key: string; cache: OrgCache }>();
export function getCache(account: Account) {
  let item = caches.get(account.id);
  const key = `${account.email}\0${account.apiKey}`;
  if (!item || item.key !== key) {
    item?.cache.dispose();
    item = { key, cache: new OrgCache(account) };
    caches.set(account.id, item);
  }
  return item.cache;
}
export function clearCache(id: string) {
  caches.get(id)?.cache.dispose();
  caches.delete(id);
}
