import type { Channel, RecentConversation, User, ZulipEvent } from "./types";
export const topicKey = (id: number, topic: string) =>
  JSON.stringify([id, topic.toLowerCase()]);
type Unread = { sender?: number; stream?: number; topic?: string };
export type Session = {
  channels: Channel[];
  users: User[];
  status: string;
  error: string;
  revision: number;
  name: string;
  unread: number;
  mutedUsers: number[];
  recentConversations: RecentConversation[];
  topicUnreads: Record<string, number>;
  mutedTopics: string[];
  unmutedTopics: string[];
  unreadIncomplete: boolean;
  locked: boolean;
  ready: boolean;
};
export const initialSession: Session = {
  channels: [],
  users: [],
  status: "Connecting",
  error: "",
  revision: 0,
  name: "",
  unread: 0,
  mutedUsers: [],
  recentConversations: [],
  topicUnreads: {},
  mutedTopics: [],
  unmutedTopics: [],
  unreadIncomplete: false,
  locked: false,
  ready: false,
};
export type Registration = {
  queue_id: string;
  last_event_id: number;
  subscriptions?: Channel[];
  realm_users?: User[];
  realm_name?: string;
  muted_users?: { id: number }[];
  recent_private_conversations?: RecentConversation[];
  user_topics?: {
    stream_id: number;
    topic_name: string;
    visibility_policy: number;
  }[];
  muted_topics?: [string, string][];
  unread_msgs?: {
    old_unreads_missing?: boolean;
    streams?: {
      stream_id: number;
      topic: string;
      unread_message_ids: number[];
    }[];
    pms?: {
      other_user_id?: number;
      sender_id?: number;
      unread_message_ids: number[];
    }[];
    huddles?: { unread_message_ids: number[] }[];
  };
  event_queue_longpoll_timeout_seconds?: number;
};
export class SessionModel {
  state: Session = initialSession;
  private unread = new Map<number, Unread>();
  register(data: Registration, name: string) {
    this.unread.clear();
    for (const group of data.unread_msgs?.streams || [])
      for (const id of group.unread_message_ids)
        this.unread.set(id, { stream: group.stream_id, topic: group.topic });
    for (const group of data.unread_msgs?.pms || [])
      for (const id of group.unread_message_ids)
        this.unread.set(id, { sender: group.other_user_id ?? group.sender_id });
    for (const group of data.unread_msgs?.huddles || [])
      for (const id of group.unread_message_ids) this.unread.set(id, {});
    this.state = {
      ...initialSession,
      channels: data.subscriptions || [],
      users: (data.realm_users || []).map((u) => ({
        ...u,
        is_active: u.is_active !== false,
      })),
      name: data.realm_name || name,
      mutedUsers: (data.muted_users || []).map((u) => u.id),
      recentConversations: data.recent_private_conversations || [],
      mutedTopics: (data.user_topics || [])
        .filter((t) => t.visibility_policy === 1)
        .map((t) => topicKey(t.stream_id, t.topic_name)),
      unmutedTopics: (data.user_topics || [])
        .filter((t) => t.visibility_policy === 2 || t.visibility_policy === 3)
        .map((t) => topicKey(t.stream_id, t.topic_name)),
      unreadIncomplete: !!data.unread_msgs?.old_unreads_missing,
      revision: this.state.revision + 1,
      ready: true,
    };
    this.count();
    return this.state;
  }
  apply(events: ZulipEvent[], me: number) {
    const before = this.state;
    let changed = false;
    for (const e of events) {
      if (e.type === "muted_users") {
        this.state = {
          ...this.state,
          mutedUsers: ((e.muted_users || []) as { id: number }[]).map(
            (u) => u.id,
          ),
        };
        changed = true;
      } else if (e.type === "subscription") {
        const subs = (e.subscriptions || []) as Channel[];
        if (e.op === "add") {
          const map = new Map(this.state.channels.map((c) => [c.stream_id, c]));
          for (const c of subs) map.set(c.stream_id, c);
          this.state = { ...this.state, channels: [...map.values()] };
          changed = true;
        }
        if (e.op === "remove") {
          const ids = new Set(subs.map((c) => c.stream_id));
          this.state = {
            ...this.state,
            channels: this.state.channels.filter((c) => !ids.has(c.stream_id)),
          };
          for (const [id, m] of this.unread)
            if (m.stream && ids.has(m.stream)) this.unread.delete(id);
          changed = true;
        }
        if (e.op === "update" && typeof e.property === "string") {
          this.state = {
            ...this.state,
            channels: this.state.channels.map((c) =>
              c.stream_id === e.stream_id
                ? { ...c, [e.property as string]: e.value }
                : c,
            ),
          };
          changed = true;
        }
      } else if (e.type === "stream") {
        if (e.op === "update" && typeof e.property === "string") {
          this.state = {
            ...this.state,
            channels: this.state.channels.map((c) =>
              c.stream_id === e.stream_id
                ? { ...c, [e.property as string]: e.value }
                : c,
            ),
          };
          changed = true;
        }
        if (e.op === "delete") {
          const ids = new Set(
            ((e.streams || []) as Channel[]).map((c) => c.stream_id),
          );
          this.state = {
            ...this.state,
            channels: this.state.channels.filter((c) => !ids.has(c.stream_id)),
          };
          changed = true;
        }
      } else if (e.type === "realm_user") {
        const p = e.person as Partial<User> | undefined;
        if (p && typeof p.user_id === "number") {
          const users = new Map(this.state.users.map((u) => [u.user_id, u]));
          if (e.op === "remove") users.delete(p.user_id);
          else
            users.set(p.user_id, {
              ...users.get(p.user_id),
              is_active: true,
              ...p,
            } as User);
          this.state = { ...this.state, users: [...users.values()] };
          changed = true;
        }
      } else if (e.type === "realm") {
        if (e.property === "name" && typeof e.value === "string") {
          this.state = { ...this.state, name: e.value };
          changed = true;
        }
        if (
          e.op === "update_dict" &&
          e.property === "default" &&
          e.data &&
          typeof (e.data as Record<string, unknown>).name === "string"
        ) {
          this.state = {
            ...this.state,
            name: (e.data as { name: string }).name,
          };
          changed = true;
        }
      } else if (
        e.type === "user_topic" &&
        typeof e.stream_id === "number" &&
        typeof e.topic_name === "string"
      ) {
        const key = topicKey(e.stream_id, e.topic_name);
        this.state = {
          ...this.state,
          unmutedTopics: [
            ...this.state.unmutedTopics.filter((t) => t !== key),
            ...([2, 3].includes(e.visibility_policy as number) ? [key] : []),
          ],
          mutedTopics: [
            ...this.state.mutedTopics.filter((t) => t !== key),
            ...(e.visibility_policy === 1 ? [key] : []),
          ],
        };
        changed = true;
      } else if (e.type === "message" && e.message) {
        const m = e.message;
        const flags = (e.flags || m.flags || []) as string[];
        if (
          !flags.includes("read") &&
          m.sender_id !== me &&
          !this.state.mutedUsers.includes(m.sender_id)
        )
          this.unread.set(m.id, {
            sender: m.sender_id,
            stream: m.stream_id,
            topic: m.subject,
          });
        if (m.type === "private" && Array.isArray(m.display_recipient)) {
          const ids = m.display_recipient
            .map((u) => u.id)
            .filter((id) => id !== me)
            .sort((a, b) => a - b);
          const key = ids.join(",");
          this.state = {
            ...this.state,
            recentConversations: [
              { user_ids: ids, max_message_id: m.id },
              ...this.state.recentConversations.filter(
                (c) => [...c.user_ids].sort((a, b) => a - b).join(",") !== key,
              ),
            ],
          };
        }
        changed = true;
      } else if (e.type === "update_message_flags" && e.flag === "read") {
        if (e.op === "add" && e.all) this.unread.clear();
        else
          for (const id of (e.messages || []) as number[]) {
            if (e.op === "add") this.unread.delete(id);
            else {
              const d = (
                (e.message_details || {}) as Record<
                  string,
                  { stream_id?: number; topic?: string; user_ids?: number[] }
                >
              )[id];
              if (d)
                this.unread.set(id, {
                  stream: d.stream_id,
                  topic: d.topic,
                  sender: d.user_ids?.length === 1 ? d.user_ids[0] : undefined,
                });
            }
          }
        changed = true;
      } else if (e.type === "delete_message") {
        for (const id of (e.message_ids || [e.message_id]) as number[])
          this.unread.delete(id);
        changed = true;
      } else if (
        e.type === "update_message" &&
        (e.subject !== undefined || e.new_stream_id !== undefined)
      ) {
        for (const id of (e.message_ids || [e.message_id]) as number[]) {
          const m = this.unread.get(id);
          if (m)
            this.unread.set(id, {
              ...m,
              ...(typeof e.subject === "string" ? { topic: e.subject } : {}),
              ...(typeof e.new_stream_id === "number"
                ? { stream: e.new_stream_id }
                : {}),
            });
        }
        changed = true;
      }
    }
    if (changed) this.count();
    else this.state = before;
    return this.state;
  }
  private count() {
    const muted = new Set(this.state.mutedUsers),
      topics = new Set(this.state.mutedTopics),
      mutedStreams = new Set(
        this.state.channels.filter((c) => c.is_muted).map((c) => c.stream_id),
      );
    let unread = 0;
    const topicUnreads: Record<string, number> = {};
    for (const [id, m] of this.unread) {
      if (m.sender !== undefined && muted.has(m.sender)) {
        this.unread.delete(id);
        continue;
      }
      if (m.stream !== undefined) {
        const key = topicKey(m.stream, m.topic || "");
        topicUnreads[key] = (topicUnreads[key] || 0) + 1;
        if (
          topics.has(key) ||
          (mutedStreams.has(m.stream) &&
            !this.state.unmutedTopics.includes(key))
        )
          continue;
      }
      unread++;
    }
    this.state = { ...this.state, unread, topicUnreads };
  }
}

export function serverMutesTopic(
  session: Session | undefined,
  streamId: number,
  topic: string,
) {
  const key = topicKey(streamId, topic);
  return (
    !!session &&
    (session.mutedTopics.includes(key) ||
      (!!session.channels.find((c) => c.stream_id === streamId)?.is_muted &&
        !session.unmutedTopics.includes(key)))
  );
}
