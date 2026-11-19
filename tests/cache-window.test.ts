import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_ACTIVE_MESSAGES, OrgCache } from "../src/cache";
import type { Account, Message, View } from "../src/types";
const account: Account = {
  id: "a",
  url: "http://localhost:8080",
  email: "me@test.invalid",
  apiKey: "test",
  name: "Test",
  userId: 1,
};
const channel: View = { type: "channel", channelId: 3, topic: "test" };
const make = (id: number, sender = 2, extra: Partial<Message> = {}) =>
  ({
    id,
    sender_id: sender,
    sender_full_name: `User ${sender}`,
    avatar_url: null,
    timestamp: id,
    content: `<p>${id}</p>`,
    type: "stream",
    stream_id: 3,
    subject: "test",
    display_recipient: "general",
    reactions: [],
    ...extra,
  }) as Message;
const range = (from: number, to: number, sender = 2) =>
  Array.from({ length: to - from + 1 }, (_, i) => make(from + i, sender));
type Call = {
  anchor: string;
  before: number;
  after: number;
  include: boolean;
};
/** A /messages endpoint over an in-memory history, recording each request. */
function server(history: () => Message[], status = () => 200) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string) => {
    const q = new URL(url).searchParams;
    const call: Call = {
      anchor: q.get("anchor")!,
      before: Number(q.get("num_before")),
      after: Number(q.get("num_after")),
      include: q.get("include_anchor") !== "false",
    };
    calls.push(call);
    if (status() !== 200)
      return new Response(JSON.stringify({ result: "error", msg: "No" }), {
        status: status(),
      });
    const all = history();
    const anchor = call.anchor === "newest" ? Infinity : Number(call.anchor);
    const before = all.filter((m) =>
      call.include ? m.id <= anchor : m.id < anchor,
    );
    const after = all.filter((m) => m.id > anchor);
    const pre = before.slice(Math.max(0, before.length - call.before)),
      post = after.slice(0, call.after);
    return new Response(
      JSON.stringify({
        result: "success",
        messages: [...pre, ...post],
        found_oldest: pre.length === before.length,
        found_newest: post.length === after.length,
      }),
    );
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}
const ids = (cache: OrgCache, view: View = channel) =>
  cache.snapshot(view).messages.map((m) => m.id);
afterEach(() => vi.unstubAllGlobals());

describe("pagination cursors ignore client-side filtering", () => {
  it("pages past a newest page that holds only muted messages", async () => {
    const calls = server(() => [...range(1, 60, 4), ...range(61, 120, 9)]);
    const cache = new OrgCache(account);
    cache.setMutedUsers([9]);
    await cache.load(channel);
    expect(ids(cache)).toEqual([]);
    expect(cache.snapshot(channel).hasOlder).toBe(true);
    await cache.older(channel);
    expect(calls.at(-1)!.anchor).toBe("61");
    expect(ids(cache)).toEqual(range(1, 60).map((m) => m.id));
    expect(cache.snapshot(channel).hasOlder).toBe(false);
  });
  it("advances through a muted page instead of re-requesting the same anchor", async () => {
    const calls = server(() => [
      ...range(1, 60, 4),
      ...range(61, 120, 9),
      make(121, 4),
    ]);
    const cache = new OrgCache(account);
    cache.setMutedUsers([9]);
    await cache.load(channel);
    while (cache.snapshot(channel).hasOlder) await cache.older(channel);
    const anchors = calls.slice(1).map((c) => c.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(ids(cache)).toEqual([...range(1, 60).map((m) => m.id), 121]);
  });
});

describe("revalidation keeps the range being read", () => {
  it("refetches around the reading anchor after queue recovery", async () => {
    let history = range(1, 200);
    const calls = server(() => history);
    const cache = new OrgCache(account);
    cache.subscribe(channel, () => {});
    await cache.load(channel);
    await cache.older(channel);
    expect(ids(cache)[0]).toBe(81);
    const ui = cache.ui(channel);
    ui.atBottom = false;
    ui.anchorId = 100;
    history = history.filter((m) => m.id !== 101);
    cache.invalidate();
    await cache.load(channel);
    const last = calls.at(-1)!;
    expect(last.anchor).toBe("100");
    expect(last.before).toBeGreaterThanOrEqual(19);
    expect(ids(cache)).toContain(100);
    expect(ids(cache)[0]).toBeLessThanOrEqual(81);
    // The authoritative response drops what the server no longer has.
    expect(ids(cache)).not.toContain(101);
  });
  it("keeps loaded history when revalidating at the live end", async () => {
    const calls = server(() => range(1, 200));
    const cache = new OrgCache(account);
    cache.subscribe(channel, () => {});
    await cache.load(channel);
    await cache.older(channel);
    cache.ui(channel).atBottom = true;
    cache.invalidate();
    await cache.load(channel);
    expect(calls.at(-1)).toMatchObject({ anchor: "newest", before: 120 });
    expect(ids(cache)).toHaveLength(120);
  });
  it("purges an anchored range when access is revoked", async () => {
    let code = 200;
    server(
      () => range(1, 200),
      () => code,
    );
    const cache = new OrgCache(account);
    cache.subscribe(channel, () => {});
    await cache.load(channel);
    Object.assign(cache.ui(channel), { atBottom: false, anchorId: 150 });
    code = 403;
    cache.invalidate();
    await cache.load(channel);
    expect(ids(cache)).toEqual([]);
  });
  it("refetches only channels a topic move touches", async () => {
    const calls = server(() => range(1, 10));
    const cache = new OrgCache(account);
    const dm: View = { type: "dm", userIds: [2] };
    const other: View = { type: "channel", channelId: 8 };
    for (const view of [channel, dm, other]) {
      cache.subscribe(view, () => {});
      await cache.load(view);
    }
    const before = calls.length;
    cache.events([
      {
        id: 1,
        type: "update_message",
        message_id: 5,
        message_ids: [5],
        stream_id: 3,
        orig_subject: "test",
        subject: "renamed",
        propagate_mode: "change_all",
      },
    ]);
    await Promise.resolve();
    expect(calls.length - before).toBe(1);
  });
});

describe("open views are bounded", () => {
  it("bounds a live tail and publishes a batch once", async () => {
    server(() => [make(1)]);
    const cache = new OrgCache(account);
    const listener = vi.fn();
    cache.subscribe(channel, listener);
    await cache.load(channel);
    listener.mockClear();
    cache.events(
      range(2, 10_001).map((message, i) => ({
        id: i + 1,
        type: "message",
        message,
      })),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ids(cache)).toHaveLength(MAX_ACTIVE_MESSAGES);
    expect(ids(cache).at(-1)).toBe(10_001);
    expect(cache.snapshot(channel).hasOlder).toBe(true);
  });
  it("keeps the history being read and pages forward to the live end", async () => {
    let history = range(1, 700);
    const calls = server(() => history);
    const cache = new OrgCache(account);
    cache.subscribe(channel, () => {});
    await cache.load(channel);
    cache.ui(channel).atBottom = false;
    while (ids(cache).length < MAX_ACTIVE_MESSAGES) await cache.older(channel);
    await cache.older(channel);
    const snapshot = cache.snapshot(channel);
    expect(snapshot.messages).toHaveLength(MAX_ACTIVE_MESSAGES);
    expect(snapshot.hasNewer).toBe(true);
    const end = ids(cache).at(-1)!;
    // A live message after the window's end must not be appended past a gap.
    history = [...history, make(701)];
    cache.events([{ id: 1, type: "message", message: make(701) }]);
    expect(ids(cache).at(-1)).toBe(end);
    while (cache.snapshot(channel).hasNewer) await cache.newer(channel);
    expect(calls.at(-1)).toMatchObject({ after: 60, include: false });
    expect(ids(cache).at(-1)).toBe(701);
    expect(ids(cache).length).toBeLessThanOrEqual(MAX_ACTIVE_MESSAGES);
    const all = ids(cache);
    expect(all).toEqual([...all].sort((a, b) => a - b));
    expect(all.at(-1)! - all[0] + 1).toBe(all.length);
  });
  it("bounds profile history too", async () => {
    const profile: View = { type: "profile", userId: 2, posts: "channels" };
    server(() => range(1, 800));
    const cache = new OrgCache(account);
    cache.subscribe(profile, () => {});
    await cache.load(profile);
    cache.ui(profile).atBottom = false;
    for (let i = 0; i < 12; i++) await cache.older(profile);
    expect(ids(cache, profile).length).toBeLessThanOrEqual(MAX_ACTIVE_MESSAGES);
    expect(cache.snapshot(profile).hasNewer).toBe(true);
  });
});
