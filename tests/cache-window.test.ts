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
    const before = all.filter((m) => m.id < anchor);
    const after = all.filter((m) => m.id > anchor);
    const pre = before.slice(Math.max(0, before.length - call.before)),
      post = after.slice(0, call.after);
    return new Response(
      JSON.stringify({
        result: "success",
        messages: [
          ...pre,
          ...(call.include ? all.filter((m) => m.id === anchor) : []),
          ...post,
        ],
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

/** Delay one intercepted response while events arrive. No network is used. */
function holdNextResponse() {
  const fetch = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
    const response = await fetch(...args);
    if (!held) {
      held = true;
      await gate;
    }
    return response;
  });
  return release;
}

async function historyWindow() {
  const cache = new OrgCache(account);
  cache.setMutedUsers([9]);
  const stop = cache.subscribe(channel, () => {});
  await cache.load(channel);
  cache.ui(channel).atBottom = false;
  while (ids(cache).length < MAX_ACTIVE_MESSAGES) await cache.older(channel);
  await cache.older(channel);
  Object.assign(cache.ui(channel), {
    atBottom: false,
    anchorId: 400,
    anchorTop: -12,
    scrollTop: 2000,
  });
  await cache.load(channel, true);
  expect(cache.snapshot(channel).hasNewer).toBe(true);
  return { cache, stop };
}

describe("history gaps and retained reading positions", () => {
  it("skips muted older pages without replaying a live message across the gap", async () => {
    let history = range(1, 1000);
    const calls = server(() => history);
    const { cache } = await historyWindow();
    const start = ids(cache)[0],
      end = ids(cache).at(-1)!;
    history = history.map((m) =>
      m.id >= start - 60 && m.id < start ? { ...m, sender_id: 9 } : m,
    );
    const release = holdNextResponse();
    const pending = cache.older(channel);
    cache.events([
      { id: 1, type: "message", message: make(1001) },
      { id: 2, type: "delete_message", message_ids: [start - 70] },
    ]);
    release();
    await pending;
    expect(calls.at(-1)!.anchor).toBe(String(start - 60));
    expect(ids(cache)).not.toContain(1001);
    expect(ids(cache)).not.toContain(start - 70);
    expect(ids(cache).at(-1)).toBe(end);
    expect(ids(cache)[0]).toBe(start - 120);
  });

  it.each(["newer", "recovery"] as const)(
    "keeps %s replay inside the fetched interval",
    async (operation) => {
      server(() => range(1, 1000));
      const { cache } = await historyWindow();
      const release = holdNextResponse();
      const pending =
        operation === "newer"
          ? cache.newer(channel)
          : cache.load(channel, true);
      cache.events([
        { id: 1, type: "message", message: make(1001) },
        { id: 2, type: "message", message: make(50) },
        {
          id: 3,
          type: "delete_message",
          message_ids: [operation === "newer" ? 710 : 410],
        },
      ]);
      release();
      await pending;
      expect(ids(cache)).not.toContain(1001);
      expect(ids(cache)).not.toContain(50);
      expect(ids(cache)).not.toContain(operation === "newer" ? 710 : 410);
      expect(ids(cache).at(-1)).toBe(operation === "newer" ? 760 : 700);
      expect(cache.snapshot(channel).hasNewer).toBe(true);
    },
  );

  it("includes in-flight live events when forward pagination reaches the live tail", async () => {
    server(() => range(1, 1000));
    const { cache } = await historyWindow();
    while (ids(cache).at(-1)! < 940) await cache.newer(channel);
    const release = holdNextResponse();
    const pending = cache.newer(channel);
    cache.events([{ id: 1, type: "message", message: make(1001) }]);
    release();
    await pending;
    expect(ids(cache).at(-1)).toBe(1001);
    expect(cache.snapshot(channel).hasNewer).toBe(false);
  });

  it.each([false, true])(
    "retains a hidden reading window and row offset (small=%s)",
    async (small) => {
      let history = range(1, 1000);
      const calls = server(() => history);
      const { cache, stop } = await historyWindow();
      if (small)
        cache.events([
          {
            id: 1,
            type: "delete_message",
            message_ids: range(500, 699).map((m) => m.id),
          },
        ]);
      const saved = { ...cache.ui(channel) };
      stop();
      expect(ids(cache).length).toBeLessThanOrEqual(300);
      expect(ids(cache)).toContain(400);
      expect(cache.ui(channel)).toEqual(saved);
      const count = calls.length;
      cache.subscribe(channel, () => {});
      await cache.load(channel);
      expect(calls).toHaveLength(count);
      expect(ids(cache)).toContain(400);
      // Recovery revalidates this retained range and removes inaccessible/deleted rows.
      history = history.filter((m) => m.id !== 401);
      cache.invalidate();
      await cache.load(channel);
      expect(calls.at(-1)!.anchor).toBe("400");
      expect(ids(cache)).toContain(400);
      expect(ids(cache)).not.toContain(401);
    },
  );

  it.each(["older", "newer", "recovery"] as const)(
    "does not revive revoked data from pending %s",
    async (operation) => {
      server(() => range(1, 1000));
      const { cache } = await historyWindow();
      cache.ui(channel).text = "private draft";
      const release = holdNextResponse();
      const pending =
        operation === "recovery"
          ? cache.load(channel, true)
          : cache[operation](channel);
      cache.purgeStreams([3]);
      release();
      await pending;
      expect(ids(cache)).toEqual([]);
      expect(cache.ui(channel).anchorId).toBeUndefined();
      expect(cache.ui(channel).anchorTop).toBeUndefined();
      expect(cache.ui(channel).text).toBe("");
    },
  );
});

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
