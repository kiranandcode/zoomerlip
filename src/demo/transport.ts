import { ApiError } from "../api";
import type { Message, Reaction, ZulipEvent } from "../types";
import { channels, sampleMessages, users } from "./data";

type Params = Record<string, unknown>;
type Narrow = { operator: string; operand: unknown; negated?: boolean }[];
const unavailable = () =>
  new ApiError(
    "This action needs a connected organization. Exit the demo to sign in.",
    "DEMO_UNAVAILABLE",
    400,
  );
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
// Intentionally small: no remote images, embeds, or executable HTML in the demo.
export function renderDemo(text: string) {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part) => {
      if (part.startsWith("```") && part.endsWith("```") && part.length >= 6)
        return `<pre><code>${escape(part.slice(3, -3).replace(/^\w*\n/, ""))}</code></pre>`;
      return `<p>${escape(part)
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
        .replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}
const recipientIds = (m: Message) =>
  Array.isArray(m.display_recipient)
    ? m.display_recipient.map((u) => u.id).sort((a, b) => a - b)
    : [];

/** Per-tab, in-memory simulator. No fetch, credentials, persistence, or sockets. */
export class DemoServer {
  private messages = sampleMessages();
  private raw = new Map<number, string>();
  private streams = structuredClone(channels);
  private events: ZulipEvent[] = [];
  private sequence = 0;
  private messageId = 1000;
  private queues = new Set<string>();
  private nextQueue = 0;
  private listeners = new Set<() => void>();
  private statuses: Record<string, unknown> = {};
  private emit(event: Omit<ZulipEvent, "id">) {
    this.events.push({ ...event, id: ++this.sequence } as ZulipEvent);
    this.events = this.events.slice(-1000);
    for (const notify of [...this.listeners]) notify();
  }
  private match(m: Message, narrow: Narrow = []) {
    return narrow.every(({ operator, operand, negated }) => {
      const value = String(operand).toLowerCase();
      let matches = false;
      switch (operator) {
        case "channel":
        case "stream":
          matches =
            m.type === "stream" &&
            (m.stream_id === Number(operand) ||
              String(m.display_recipient).toLowerCase() === value);
          break;
        case "channels":
        case "streams":
          matches = m.type === "stream";
          break;
        case "topic":
          matches = m.subject.toLowerCase() === value;
          break;
        case "sender":
          matches =
            m.sender_id === Number(operand) ||
            users.find((u) => u.user_id === m.sender_id)?.email === operand;
          break;
        case "dm":
        case "pm-with": {
          const ids = [
            ...new Set([
              1,
              ...(Array.isArray(operand)
                ? operand
                : String(operand).split(",")
              ).map(Number),
            ]),
          ].sort((a, b) => a - b);
          matches =
            m.type === "private" &&
            JSON.stringify(recipientIds(m)) === JSON.stringify(ids);
          break;
        }
        case "is":
          matches =
            value === "private" || value === "dm"
              ? m.type === "private"
              : value === "unread"
                ? !m.flags?.includes("read")
                : !!m.flags?.includes(value);
          break;
        case "search":
          matches = (this.raw.get(m.id) ?? m.content.replace(/<[^>]*>/g, " "))
            .toLowerCase()
            .includes(value);
          break;
        case "after":
          matches = m.timestamp * 1000 > Date.parse(String(operand));
          break;
        case "before":
          matches = m.timestamp * 1000 < Date.parse(String(operand));
          break;
        case "has":
          matches = false;
          break;
        default:
          throw unavailable();
      }
      return negated ? !matches : matches;
    });
  }
  private page(p: Params) {
    const all = this.messages.filter((m) => this.match(m, p.narrow as Narrow));
    if (Array.isArray(p.message_ids))
      return {
        messages: all.filter((m) => (p.message_ids as number[]).includes(m.id)),
        found_oldest: true,
        found_newest: true,
      };
    const anchor =
      p.anchor === "oldest"
        ? -Infinity
        : p.anchor === "newest" || p.anchor === undefined
          ? Infinity
          : Number(p.anchor);
    const count = Math.max(0, Number(p.num_before ?? 100));
    const before = count ? all.filter((m) => m.id < anchor).slice(-count) : [];
    const after = all
      .filter((m) => m.id > anchor)
      .slice(0, Math.max(0, Number(p.num_after ?? 0)));
    const center =
      p.include_anchor === false ? [] : all.filter((m) => m.id === anchor);
    const messages = [...before, ...center, ...after];
    return {
      messages,
      found_anchor: center.length > 0,
      found_oldest: !all.length || messages[0]?.id === all[0]?.id,
      found_newest: !all.length || messages.at(-1)?.id === all.at(-1)?.id,
    };
  }
  private presences() {
    const now = Math.floor(Date.now() / 1000);
    return Object.fromEntries(
      users.map((u, i) => [
        u.user_id,
        i < 4 ? { active_timestamp: now } : { idle_timestamp: now },
      ]),
    );
  }
  private async poll(p: Params, signal?: AbortSignal) {
    const queue = String(p.queue_id);
    if (!this.queues.has(queue))
      throw new ApiError("Demo queue expired", "BAD_EVENT_QUEUE_ID", 400);
    const since = Number(p.last_event_id ?? -1);
    if (since < this.sequence - 1000)
      throw new ApiError("Demo queue expired", "BAD_EVENT_QUEUE_ID", 400);
    if (!p.dont_block && !this.events.some((e) => e.id > since)) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          this.listeners.delete(wake);
          signal?.removeEventListener("abort", abort);
        };
        const wake = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(wake, 25000);
        this.listeners.add(wake);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
    return { events: this.events.filter((e) => e.id > since) };
  }
  async request(
    path: string,
    p: Params | FormData = {},
    method = "GET",
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (p instanceof FormData) throw unavailable();
    const data = await this.handle(path, p, method, signal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return structuredClone({ result: "success", msg: "", ...data });
  }
  private async handle(
    path: string,
    p: Params,
    method: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (path === "/register" && method === "POST") {
      const queue_id = `demo-${++this.nextQueue}`;
      this.queues.add(queue_id);
      if (this.queues.size > 8)
        this.queues.delete(this.queues.values().next().value!);
      return {
        queue_id,
        last_event_id: this.sequence,
        zulip_feature_level: 177,
        realm_name: "Proof Club",
        subscriptions: this.streams,
        realm_users: users,
        realm_allow_message_editing: true,
        realm_message_content_edit_limit_seconds: 0,
        max_file_upload_size_mib: 0,
        max_message_length: 10000,
        max_topic_length: 60,
        user_settings: {
          enable_desktop_notifications: false,
          enable_sounds: false,
        },
        user_status: this.statuses,
        user_topics: [],
        unread_msgs: { streams: [], pms: [] },
        recent_private_conversations: [
          { user_ids: [1, 2], max_message_id: 123 },
          { user_ids: [1, 3], max_message_id: 124 },
        ],
      };
    }
    if (path === "/events") {
      if (method === "GET") return this.poll(p, signal);
      if (method === "DELETE") {
        this.queues.delete(String(p.queue_id));
        for (const wake of [...this.listeners]) wake();
        return {};
      }
    }
    if (path === "/messages/render" && method === "POST")
      return { rendered: renderDemo(String(p.content ?? "")) };
    if (path === "/messages" && method === "GET") return this.page(p);
    if (path === "/messages" && method === "POST") {
      if (this.messages.length >= 500)
        throw new ApiError("Demo limit reached. Reload to start over.");
      const raw = String(p.content ?? "").trim();
      if (!raw || raw.length > 10000)
        throw new ApiError("Enter a message under 10,000 characters.");
      const stream =
        p.type === "stream"
          ? this.streams.find((s) => s.stream_id === Number(p.to))
          : undefined;
      const recipients =
        p.type === "private" && Array.isArray(p.to)
          ? [...new Set([1, ...p.to.map(Number)])]
          : [];
      if (
        !stream &&
        (!recipients.length ||
          recipients.some((id) => !users.some((u) => u.user_id === id)))
      )
        throw unavailable();
      if (
        stream &&
        (!String(p.topic ?? "").trim() || String(p.topic).length > 60)
      )
        throw new ApiError("Choose a topic under 60 characters.");
      const content = renderDemo(raw);
      const message: Message = {
        id: ++this.messageId,
        sender_id: 1,
        sender_full_name: users[0].full_name,
        avatar_url: null,
        timestamp: Math.floor(Date.now() / 1000),
        content,
        rendered_content: content,
        type: stream ? "stream" : "private",
        ...(stream ? { stream_id: stream.stream_id } : {}),
        subject: stream ? String(p.topic) : "",
        display_recipient: stream
          ? stream.name
          : users
              .filter((u) => recipients.includes(u.user_id))
              .map((u) => ({
                id: u.user_id,
                full_name: u.full_name,
                email: u.email,
              })),
        flags: ["read"],
        reactions: [],
      };
      this.raw.set(message.id, raw);
      this.messages.push(message);
      this.emit({ type: "message", message });
      return { id: message.id };
    }
    if (
      (path === "/messages/flags" || path === "/messages/flags/narrow") &&
      method === "POST"
    ) {
      const targets = path.endsWith("/narrow")
        ? this.messages.filter((m) => this.match(m, p.narrow as Narrow))
        : this.messages.filter(
            (m) => Array.isArray(p.messages) && p.messages.includes(m.id),
          );
      if (
        !["read", "starred"].includes(String(p.flag)) ||
        !["add", "remove"].includes(String(p.op))
      )
        throw unavailable();
      for (const m of targets)
        m.flags = [
          ...new Set([
            ...(m.flags ?? []).filter((f) => f !== p.flag),
            ...(p.op === "add" ? [String(p.flag)] : []),
          ]),
        ];
      this.emit({
        type: "update_message_flags",
        messages: targets.map((m) => m.id),
        op: p.op,
        flag: p.flag,
        all: false,
      });
      return {
        messages: targets.map((m) => m.id),
        found_oldest: true,
        first_processed_id: targets[0]?.id ?? null,
      };
    }
    const messagePath =
      /^\/messages\/(\d+)(?:\/(reactions|read_receipts|history))?$/.exec(path);
    if (messagePath) {
      const m = this.messages.find((m) => m.id === Number(messagePath[1]));
      if (!m) throw new ApiError("Message not found", "BAD_REQUEST", 404);
      if (
        messagePath[2] === "reactions" &&
        ["POST", "DELETE"].includes(method)
      ) {
        if (
          p.reaction_type !== "unicode_emoji" ||
          !/^[a-f0-9]+(?:-[a-f0-9]+)*$/i.test(String(p.emoji_code))
        )
          throw unavailable();
        const r: Reaction = {
          emoji_name: String(p.emoji_name),
          emoji_code: String(p.emoji_code),
          reaction_type: "unicode_emoji",
          user_id: 1,
        };
        m.reactions = m.reactions.filter(
          (v) => !(v.user_id === 1 && v.emoji_code === r.emoji_code),
        );
        if (method === "POST") m.reactions.push(r);
        this.emit({
          type: "reaction",
          message_id: m.id,
          op: method === "POST" ? "add" : "remove",
          ...r,
        });
        return {};
      }
      if (messagePath[2] === "read_receipts" && method === "GET")
        return { user_ids: [1, 2, 3] };
      if (messagePath[2] === "history" && method === "GET")
        return { message_history: [] };
      if (!messagePath[2] && method === "GET")
        return {
          message:
            p.apply_markdown === false
              ? {
                  ...m,
                  content:
                    this.raw.get(m.id) ?? m.content.replace(/<[^>]*>/g, " "),
                }
              : m,
        };
      if (
        !messagePath[2] &&
        m.sender_id === 1 &&
        method === "PATCH" &&
        typeof p.content === "string"
      ) {
        if (!p.content.trim() || p.content.length > 10000)
          throw new ApiError("Enter a message under 10,000 characters.");
        m.content = m.rendered_content = renderDemo(p.content);
        this.raw.set(m.id, p.content);
        this.emit({
          type: "update_message",
          message_id: m.id,
          message_ids: [m.id],
          rendered_content: m.content,
          content: p.content,
        });
        return {};
      }
      if (!messagePath[2] && m.sender_id === 1 && method === "DELETE") {
        this.messages = this.messages.filter((v) => v.id !== m.id);
        this.raw.delete(m.id);
        this.emit({
          type: "delete_message",
          message_id: m.id,
          message_ids: [m.id],
        });
        return {};
      }
    }
    const topics = /^\/users\/me\/(\d+)\/topics$/.exec(path);
    if (topics && method === "GET") {
      const byName = new Map<string, number>();
      for (const m of this.messages)
        if (m.stream_id === Number(topics[1])) byName.set(m.subject, m.id);
      return {
        topics: [...byName]
          .map(([name, max_id]) => ({ name, max_id }))
          .sort((a, b) => b.max_id - a.max_id),
      };
    }
    if (path === "/users/me/presence" && method === "POST")
      return { presences: this.presences() };
    if (path === "/typing" && method === "POST") return {};
    if (path === "/users/me/status" && method === "POST") {
      this.statuses[1] = p;
      this.emit({ type: "user_status", user_id: 1, ...p });
      return {};
    }
    if (method === "GET") {
      if (path === "/users") return { members: users };
      if (path === "/users/me") return { ...users[0] };
      const user = /^\/users\/(\d+)$/.exec(path);
      if (user)
        return { user: users.find((u) => u.user_id === Number(user[1])) };
      if (path === "/streams") return { streams: this.streams };
      if (path === "/users/me/subscriptions")
        return { subscriptions: this.streams };
      if (path === "/user_groups") return { user_groups: [] };
      if (path === "/realm/emoji") return { emoji: {} };
      if (path === "/realm/linkifiers") return { linkifiers: [] };
      if (path === "/realm/profile_fields") return { custom_fields: [] };
    }
    if (
      path === "/users/me/subscriptions/properties" &&
      method === "POST" &&
      Array.isArray(p.subscription_data)
    ) {
      const changes = p.subscription_data as {
        stream_id: number;
        property: string;
        value: unknown;
      }[];
      if (
        changes.some(
          (c) =>
            c.property !== "is_muted" ||
            typeof c.value !== "boolean" ||
            !this.streams.some((s) => s.stream_id === c.stream_id),
        )
      )
        throw unavailable();
      for (const c of changes) {
        this.streams.find((s) => s.stream_id === c.stream_id)!.is_muted =
          c.value as boolean;
        this.emit({ type: "subscription", op: "update", ...c });
      }
      return {};
    }
    // Never pretend unsupported actions succeeded, and never contact a real org.
    throw unavailable();
  }
}
const server = new DemoServer();
export const demoRequest = server.request.bind(server);
