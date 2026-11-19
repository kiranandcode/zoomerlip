import { organisationSettings } from "./organisation/permissions";
import type { OrganisationSettings } from "./organisation/permissions";
import type { Channel, RecentConversation, User, ZulipEvent } from "./types";
export const topicKey = (id: number, topic: string) =>
  JSON.stringify([id, topic.toLowerCase()]);
type Unread = {
  sender?: number;
  stream?: number;
  topic?: string;
  /** topicKey(stream, topic), computed once instead of on every recount. */
  key?: string;
};
export type Session = {
  organisation: OrganisationSettings;
  followedTopics: string[];
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
  organisation: {},
  followedTopics: [],
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
  [key: string]: unknown;
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
  private total = 0;
  private topicCounts: Record<string, number> = {};
  private countsDirty = false;
  private muted = new Set<number>();
  private mutedTopics = new Set<string>();
  private unmutedTopics = new Set<string>();
  private mutedStreams = new Set<number>();
  private adjust(m: Unread, delta: number) {
    if (m.stream !== undefined) {
      const key = (m.key ??= topicKey(m.stream, m.topic || ""));
      const count = (this.topicCounts[key] || 0) + delta;
      if (count) this.topicCounts[key] = count;
      else delete this.topicCounts[key];
      if (
        this.mutedTopics.has(key) ||
        (this.mutedStreams.has(m.stream) && !this.unmutedTopics.has(key))
      )
        return;
    }
    this.total += delta;
  }
  private removeUnread(id: number) {
    const old = this.unread.get(id);
    if (!old) return;
    this.adjust(old, -1);
    this.unread.delete(id);
    this.countsDirty = true;
  }
  private addUnread(id: number, message: Unread) {
    this.removeUnread(id);
    if (message.sender !== undefined && this.muted.has(message.sender)) return;
    this.unread.set(id, message);
    this.adjust(message, 1);
    this.countsDirty = true;
  }
  private publishCounts() {
    if (!this.countsDirty) return;
    this.state = {
      ...this.state,
      unread: this.total,
      topicUnreads: { ...this.topicCounts },
    };
    this.countsDirty = false;
  }
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
      organisation: organisationSettings(data),
      followedTopics: (data.user_topics || [])
        .filter((t) => t.visibility_policy === 3)
        .map((t) => topicKey(t.stream_id, t.topic_name)),
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
            if (m.stream && ids.has(m.stream)) this.removeUnread(id);
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
          for (const [id, message] of this.unread)
            if (message.stream !== undefined && ids.has(message.stream))
              this.removeUnread(id);
          changed = true;
        }
      } else if (e.type === "realm_user") {
        const p = e.person as Partial<User> | undefined;
        if (p?.user_id === me)
          this.state = {
            ...this.state,
            organisation: {
              ...this.state.organisation,
              ...organisationSettings(p as Record<string, unknown>),
            },
          };
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
      } else if (
        e.type === "realm_user_settings_defaults" &&
        typeof e.property === "string"
      ) {
        this.state = {
          ...this.state,
          organisation: {
            ...this.state.organisation,
            realm_user_settings_defaults: {
              ...((this.state.organisation
                .realm_user_settings_defaults as Record<string, unknown>) ||
                {}),
              [e.property as string]: e.value,
            },
          },
        };
        changed = true;
      } else if (e.type === "realm") {
        const updates =
          e.op === "update_dict" && e.data && typeof e.data === "object"
            ? e.data
            : typeof e.property === "string"
              ? { [e.property]: e.value }
              : {};
        this.state = {
          ...this.state,
          organisation: {
            ...this.state.organisation,
            ...organisationSettings(
              Object.fromEntries(
                Object.entries(updates).map(([key, value]) => [
                  `realm_${key}`,
                  value,
                ]),
              ),
            ),
          },
        };
        changed = true;
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
          followedTopics: [
            ...this.state.followedTopics.filter((t) => t !== key),
            ...(e.visibility_policy === 3 ? [key] : []),
          ],
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
          !this.muted.has(m.sender_id)
        )
          this.addUnread(m.id, {
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
        changed ||= this.countsDirty || m.type === "private";
      } else if (e.type === "update_message_flags" && e.flag === "read") {
        if (e.op === "add" && e.all) {
          this.unread.clear();
          this.total = 0;
          this.topicCounts = {};
          this.countsDirty = true;
        } else
          for (const id of (e.messages || []) as number[]) {
            if (e.op === "add") this.removeUnread(id);
            else {
              const d = (
                (e.message_details || {}) as Record<
                  string,
                  { stream_id?: number; topic?: string; user_ids?: number[] }
                >
              )[id];
              if (d)
                this.addUnread(id, {
                  stream: d.stream_id,
                  topic: d.topic,
                  sender: d.user_ids?.length === 1 ? d.user_ids[0] : undefined,
                });
            }
          }
        changed = true;
      } else if (e.type === "delete_message") {
        for (const id of (e.message_ids || [e.message_id]) as number[])
          this.removeUnread(id);
        changed = true;
      } else if (
        e.type === "update_message" &&
        (e.subject !== undefined || e.new_stream_id !== undefined)
      ) {
        for (const id of (e.message_ids || [e.message_id]) as number[]) {
          const m = this.unread.get(id);
          if (m)
            this.addUnread(id, {
              ...m,
              key: undefined,
              ...(typeof e.subject === "string" ? { topic: e.subject } : {}),
              ...(typeof e.new_stream_id === "number"
                ? { stream: e.new_stream_id }
                : {}),
            });
        }
        changed = true;
      }
      // Only policy/directory changes require walking existing unread IDs.
      if (
        ["muted_users", "subscription", "stream", "user_topic"].includes(e.type)
      )
        this.count();
    }
    if (changed) this.publishCounts();
    else this.state = before;
    return this.state;
  }
  private count() {
    this.muted = new Set(this.state.mutedUsers);
    this.mutedTopics = new Set(this.state.mutedTopics);
    this.unmutedTopics = new Set(this.state.unmutedTopics);
    this.mutedStreams = new Set(
      this.state.channels.filter((c) => c.is_muted).map((c) => c.stream_id),
    );
    this.total = 0;
    this.topicCounts = {};
    for (const [id, message] of this.unread) {
      if (message.sender !== undefined && this.muted.has(message.sender)) {
        this.unread.delete(id);
        continue;
      }
      this.adjust(message, 1);
    }
    this.countsDirty = true;
    this.publishCounts();
  }
}

const topicIndexes = new WeakMap<string[], Set<string>>();
const channelIndexes = new WeakMap<Channel[], Set<number>>();
function topicIndex(topics: string[]) {
  let index = topicIndexes.get(topics);
  if (!index) {
    index = new Set(topics);
    topicIndexes.set(topics, index);
  }
  return index;
}
export function serverMutesTopic(
  session: Session | undefined,
  streamId: number,
  topic: string,
) {
  if (!session) return false;
  let streams = channelIndexes.get(session.channels);
  if (!streams) {
    streams = new Set(
      session.channels.filter((c) => c.is_muted).map((c) => c.stream_id),
    );
    channelIndexes.set(session.channels, streams);
  }
  const key = topicKey(streamId, topic);
  return (
    topicIndex(session.mutedTopics).has(key) ||
    (streams.has(streamId) && !topicIndex(session.unmutedTopics).has(key))
  );
}
