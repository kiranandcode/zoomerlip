import { afterEach, describe, expect, it, vi } from "vitest";
import { OrgCache } from "../src/cache";
import type { Account, Message, View, ZulipEvent } from "../src/types";
const account: Account = {
  id: "race-account",
  url: "http://localhost:8080",
  email: "test@example.invalid",
  apiKey: "synthetic-key",
  name: "Test",
  userId: 1,
};
const view: View = { type: "channel", channelId: 3, topic: "topic" };
const message = (id: number, sender = 1, stream = 3): Message => ({
  id,
  sender_id: sender,
  sender_full_name: "Test",
  avatar_url: null,
  timestamp: id,
  content: "<p>test</p>",
  type: "stream",
  stream_id: stream,
  subject: "topic",
  display_recipient: "general",
  reactions: [],
});
const history = (messages: Message[], found_oldest = true) =>
  new Response(JSON.stringify({ result: "success", messages, found_oldest }));
const topics = (names: string[]) =>
  new Response(
    JSON.stringify({
      result: "success",
      topics: names.map((name, i) => ({ name, max_id: i + 1 })),
    }),
  );
const deferred = () => {
  let resolve!: (response: Response) => void;
  return {
    promise: new Promise<Response>((r) => {
      resolve = r;
    }),
    resolve: (r: Response) => resolve(r),
  };
};
const overflow: ZulipEvent[] = Array.from({ length: 2001 }, (_, i) => ({
  id: i + 2,
  type: "update_message_flags",
  messages: [],
  op: "add",
  flag: "read",
}));
afterEach(() => vi.unstubAllGlobals());

describe("recovery generations", () => {
  it("discards pre-recovery pagination and its found_oldest flag", async () => {
    const page = deferred();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(history([message(20)], false))
      .mockReturnValueOnce(page.promise)
      .mockResolvedValueOnce(history([message(30)], false));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    const stop = cache.subscribe(view, () => {});
    await cache.load(view);
    const pending = cache.older(view);
    cache.invalidate();
    await cache.load(view);
    page.resolve(history([message(10)], true));
    await pending;
    expect(cache.snapshot(view).messages.map((m) => m.id)).toEqual([30]);
    expect(cache.snapshot(view).hasOlder).toBe(true);
    stop();
  });
  it("restarts pre-recovery topic requests instead of caching their late result", async () => {
    const old = deferred();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(topics(["fresh"]));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    const pending = cache.topics(3);
    cache.invalidate();
    expect(await cache.topics(3)).toEqual([{ name: "fresh", max_id: 1 }]);
    old.resolve(topics(["old"]));
    expect(await pending).toEqual([{ name: "fresh", max_id: 1 }]);
    expect(cache.peekTopics(3)?.[0].name).toBe("fresh");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["delete_message", "update_message"])(
    "reconciles %s during an expanded-topic fetch",
    async (type) => {
      const old = deferred();
      const fetch = vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce(topics(["fresh"]));
      vi.stubGlobal("fetch", fetch);
      const cache = new OrgCache(account);
      const pending = cache.topics(3);
      cache.events([
        {
          id: 1,
          type,
          stream_id: 3,
          message_ids: [10],
          ...(type === "update_message"
            ? {
                subject: "fresh",
                orig_subject: "old",
                propagate_mode: "change_all",
              }
            : {}),
        },
      ]);
      old.resolve(topics(["old"]));
      expect(await pending).toEqual([{ name: "fresh", max_id: 1 }]);
      expect(cache.peekTopics(3)?.[0].name).toBe("fresh");
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
  it("deduplicates pagination and ignores pages superseded by a forced refresh", async () => {
    const old = deferred();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(history([message(20)], false))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(history([message(30)], false));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    await cache.load(view);
    const a = cache.older(view),
      b = cache.older(view);
    await cache.load(view, true);
    old.resolve(history([message(10)]));
    await Promise.all([a, b]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(cache.snapshot(view).messages.map((m) => m.id)).toEqual([30]);
  });
});

describe("bounded event replay", () => {
  it("refetches newest history when more than 2000 events hide a deletion", async () => {
    const old = deferred();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(history([]));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    const pending = cache.load(view);
    cache.events([
      { id: 1, type: "delete_message", stream_id: 3, message_ids: [10] },
      ...overflow,
    ]);
    old.resolve(history([message(10)]));
    await pending;
    expect(cache.snapshot(view).messages).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("never merges an older page whose replay window has overflowed", async () => {
    const old = deferred();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(history([message(30)], false))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(history([message(30)], false));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    await cache.load(view);
    const pending = cache.older(view);
    cache.events([
      { id: 1, type: "delete_message", stream_id: 3, message_ids: [10] },
      ...overflow,
    ]);
    old.resolve(history([message(10)], true));
    await pending;
    expect(cache.snapshot(view).messages.map((m) => m.id)).toEqual([30]);
    expect(cache.snapshot(view).hasOlder).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("refetches topics when their replay window has overflowed", async () => {
    const old = deferred();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(topics([]));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    const pending = cache.topics(3);
    cache.events(overflow);
    old.resolve(topics(["stale"]));
    expect(await pending).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("sensitive history boundaries", () => {
  it("filters muted authors from loaded history, profiles, live events and late responses", async () => {
    const old = deferred();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(history([message(10, 2), message(20)]))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(history([message(10, 2), message(20)]));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    await cache.load(view);
    const late = cache.load(view, true);
    cache.setMutedUsers([2]);
    expect(cache.snapshot(view).messages.map((m) => m.id)).toEqual([20]);
    old.resolve(history([message(10, 2)]));
    await late;
    cache.events([{ id: 1, type: "message", message: message(30, 2) }]);
    await cache.load(view);
    expect(cache.snapshot(view).messages.map((m) => m.id)).toEqual([20]);
    expect(
      cache.resolveView({ type: "profile", userId: 2, posts: "all" }),
    ).toEqual({ type: "home" });
  });
  it("purges revoked channels from every view and draft, rejects late data, and requires an explicit grant", async () => {
    const old = deferred(),
      profile: View = { type: "profile", userId: 1, posts: "all" };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(history([message(10)]))
      .mockResolvedValueOnce(history([message(10), message(20, 1, 4)]))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(history([message(30)]));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    await cache.load(view);
    await cache.load(profile);
    cache.ui(view).text = "private draft";
    const late = cache.load(view, true);
    cache.purgeStreams([3]);
    old.resolve(history([message(10)]));
    await late;
    await cache.load(view);
    expect(cache.snapshot(view).messages).toEqual([]);
    expect(cache.ui(view).text).toBe("");
    expect(cache.snapshot(profile).messages.map((m) => m.id)).toEqual([20]);
    expect(cache.resolveView(view)).toEqual({ type: "home" });
    expect(fetch).toHaveBeenCalledTimes(3);
    cache.allowStreams([3]);
    await cache.load(view);
    expect(cache.snapshot(view).messages.map((m) => m.id)).toEqual([30]);
  });
  it("removes cached private content after a denied refresh", async () => {
    const profile: View = { type: "profile", userId: 1, posts: "all" };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(history([message(10)]))
      .mockResolvedValueOnce(history([message(10)]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: "error", msg: "Forbidden" }), {
          status: 403,
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    await cache.load(view);
    await cache.load(profile);
    await cache.load(view, true);
    expect(cache.snapshot(view).messages).toEqual([]);
    expect(cache.snapshot(profile).messages).toEqual([]);
    expect(cache.snapshot(view).error).toBe("Forbidden");
  });
  it("locks snapshots and drafts on terminal auth failure, ignoring late responses until unlock", async () => {
    const old = deferred();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(history([message(10)]))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(history([message(20)]));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    await cache.load(view);
    cache.ui(view).text = "secret";
    const late = cache.load(view, true);
    cache.lock();
    old.resolve(history([message(10)]));
    await late;
    await cache.load(view);
    expect(cache.snapshot(view).messages).toEqual([]);
    expect(cache.ui(view).text).toBe("");
    expect(fetch).toHaveBeenCalledTimes(2);
    cache.unlock();
    await cache.load(view);
    expect(cache.snapshot(view).messages.map((m) => m.id)).toEqual([20]);
  });
  it("keeps active pagination but bounds a history as soon as it becomes inactive", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          history(Array.from({ length: 350 }, (_, i) => message(i))),
        ),
    );
    const cache = new OrgCache(account);
    const stop = cache.subscribe(view, () => {});
    await cache.load(view);
    expect(cache.snapshot(view).messages).toHaveLength(350);
    stop();
    expect(cache.snapshot(view).messages).toHaveLength(300);
    expect(cache.snapshot(view).hasOlder).toBe(true);
  });
});

describe("topic navigation", () => {
  it("moves an unsent draft and navigation only for a whole-topic rename", () => {
    const cache = new OrgCache(account);
    cache.ui(view).text = "Keep this draft";
    let notifications = 0;
    cache.subscribeNavigation(() => notifications++);
    cache.events([
      {
        id: 1,
        type: "update_message",
        message_id: 10,
        message_ids: [10],
        stream_id: 3,
        orig_subject: "topic",
        subject: "new",
        propagate_mode: "change_one",
      },
    ]);
    expect(cache.resolveView(view)).toEqual(view);
    cache.events([
      {
        id: 2,
        type: "update_message",
        message_id: 10,
        message_ids: [10],
        stream_id: 3,
        orig_subject: "topic",
        subject: "later",
        propagate_mode: "change_later",
      },
    ]);
    expect(cache.resolveView(view)).toEqual(view);
    cache.events([
      {
        id: 3,
        type: "update_message",
        message_id: 10,
        message_ids: [10],
        stream_id: 3,
        new_stream_id: 4,
        orig_subject: "topic",
        subject: "new",
        propagate_mode: "change_all",
      },
    ]);
    const target: View = { type: "channel", channelId: 4, topic: "new" };
    expect(cache.resolveView(view)).toEqual(target);
    expect(cache.ui(target).text).toBe("Keep this draft");
    expect(cache.ui(target).topic).toBe("new");
    expect(notifications).toBe(1);
  });
  it("handles an empty topic and channel-only move", () => {
    const cache = new OrgCache(account),
      old: View = { type: "channel", channelId: 3, topic: "" };
    cache.events([
      {
        id: 1,
        type: "update_message",
        message_id: 10,
        message_ids: [10],
        stream_id: 3,
        new_stream_id: 4,
        orig_subject: "",
        propagate_mode: "change_all",
      },
    ]);
    expect(cache.resolveView(old)).toEqual({
      type: "channel",
      channelId: 4,
      topic: "",
    });
  });
});
