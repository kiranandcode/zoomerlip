import { serverMutesTopic, topicKey } from "./sessionModel";
import type { Session } from "./sessionModel";
import type { Topic } from "./types";

/** Share mute-aware counts between the org badge and its navigation. */
export function navigationUnreads(
  session: Session | undefined,
  localMutes: Record<string, unknown>,
) {
  const channels: Record<number, number> = {};
  const topics: Record<number, Topic[]> = {};
  let removed = 0;
  for (const [key, count] of Object.entries(session?.topicUnreads || {})) {
    const [id, name] = JSON.parse(key) as [number, string];
    if (serverMutesTopic(session, id, name)) continue;
    if (localMutes[key]) {
      removed += count;
      continue;
    }
    if (count <= 0) continue;
    channels[id] = (channels[id] || 0) + count;
    (topics[id] ||= []).push({ name, max_id: 0 });
  }
  return {
    channels,
    topics,
    total: Math.max(0, (session?.unread || 0) - removed),
  };
}

/** Unread threads remain discoverable even outside the fetched recent topics. */
export function prioritizeUnreadTopics(
  id: number,
  loaded: Topic[] | undefined,
  unread: Topic[] = [],
) {
  const keys = new Set(unread.map((t) => topicKey(id, t.name)));
  const merged = new Map((loaded || []).map((t) => [topicKey(id, t.name), t]));
  for (const topic of unread) {
    const key = topicKey(id, topic.name);
    if (!merged.has(key)) merged.set(key, topic);
  }
  const first: Topic[] = [],
    rest: Topic[] = [];
  for (const [key, topic] of merged) (keys.has(key) ? first : rest).push(topic);
  return [...first, ...rest];
}
