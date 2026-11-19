import { afterEach, describe, expect, it, vi } from "vitest";
import { OrgCache, applyMessageEvent, matchesView } from "../src/cache";
import { narrow } from "../src/api";
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
const message: Message = {
  id: 10,
  sender_id: 1,
  sender_full_name: "Me",
  avatar_url: null,
  timestamp: 1,
  content: "<p>one</p>",
  type: "stream",
  stream_id: 3,
  subject: "test",
  display_recipient: "general",
  reactions: [],
};
afterEach(() => vi.unstubAllGlobals());
const response = (messages: Message[]) =>
  new Response(
    JSON.stringify({
      result: "success",
      messages,
      found_oldest: true,
      found_newest: true,
    }),
  );
describe("event-driven cache", () => {
  it("deduplicates loads and reuses warm views without fetching", async () => {
    const fetch = vi.fn().mockResolvedValue(response([message]));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    await Promise.all([cache.load(channel), cache.load(channel)]);
    await cache.load(channel);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.snapshot(channel).messages).toHaveLength(1);
  });
  it("updates reactions, edits, and deletes without a history request", async () => {
    const fetch = vi.fn().mockResolvedValue(response([message]));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    await cache.load(channel);
    cache.events([
      {
        id: 1,
        type: "reaction",
        message_id: 10,
        op: "add",
        emoji_name: "heart",
        emoji_code: "2764",
        reaction_type: "unicode_emoji",
        user_id: 2,
      },
    ]);
    expect(cache.snapshot(channel).messages[0].reactions).toHaveLength(1);
    cache.events([
      {
        id: 2,
        type: "update_message",
        message_id: 10,
        message_ids: [10],
        rendered_content: "<p>edited</p>",
      },
    ]);
    expect(cache.snapshot(channel).messages[0].content).toBe("<p>edited</p>");
    cache.events([{ id: 3, type: "delete_message", message_ids: [10] }]);
    expect(cache.snapshot(channel).messages).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("replays in-flight events so an old response cannot resurrect deleted messages", async () => {
    let finish!: (r: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const cache = new OrgCache(account);
    const pending = cache.load(channel);
    cache.events([{ id: 1, type: "delete_message", message_ids: [10] }]);
    finish(response([message]));
    await pending;
    expect(cache.snapshot(channel).messages).toEqual([]);
  });
  it("moves known messages between cached topic views", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response([message]))
      .mockResolvedValueOnce(response([]));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    const target: View = { type: "channel", channelId: 3, topic: "moved" };
    await cache.load(channel);
    await cache.load(target);
    cache.events([
      {
        id: 1,
        type: "update_message",
        message_id: 10,
        message_ids: [10],
        subject: "moved",
        orig_subject: "test",
        stream_id: 3,
      },
    ]);
    expect(cache.snapshot(channel).messages).toHaveLength(0);
    expect(cache.snapshot(target).messages[0].subject).toBe("moved");
  });
  it("isolates org caches and preserves exact group DM membership", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(response([]))),
    );
    const a = new OrgCache(account),
      b = new OrgCache({ ...account, id: "b" });
    await a.load(channel);
    await b.load(channel);
    a.events([{ id: 1, type: "message", message }]);
    expect(a.snapshot(channel).messages).toHaveLength(1);
    expect(b.snapshot(channel).messages).toHaveLength(0);
    const dm = {
      ...message,
      type: "private" as const,
      display_recipient: [
        { id: 1, full_name: "Me", email: "" },
        { id: 2, full_name: "Two", email: "" },
        { id: 3, full_name: "Three", email: "" },
      ],
    };
    expect(matchesView(dm, { type: "dm", userIds: [2] }, 1)).toBe(false);
    expect(matchesView(dm, { type: "dm", userIds: [2, 3] }, 1)).toBe(true);
  });
  it("does not change unaffected view snapshots", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([message])));
    const cache = new OrgCache(account);
    await cache.load(channel);
    const before = cache.snapshot(channel);
    cache.events([
      { id: 1, type: "message", message: { ...message, id: 11, stream_id: 9 } },
    ]);
    expect(cache.snapshot(channel)).toBe(before);
  });
  it("uses sender IDs and honours channel-only profile history", () => {
    const profile: View = { type: "profile", userId: 1, posts: "channels" };
    expect(narrow(profile)).toEqual([
      { operator: "sender", operand: 1 },
      { operator: "is", operand: "private", negated: true },
    ]);
    expect(matchesView(message, profile, 1)).toBe(true);
    expect(matchesView({ ...message, type: "private" }, profile, 1)).toBe(
      false,
    );
    expect(
      applyMessageEvent(
        [message],
        { id: 1, type: "message", message },
        profile,
        1,
      ),
    ).toHaveLength(1);
  });
});

describe("cache lifecycle", () => {
  it("refreshes subscribed entries once after queue recovery, even when listeners read snapshots", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(response([message])));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    await cache.load(channel);
    const listener = vi.fn(() => cache.snapshot(channel));
    const unsubscribe = cache.subscribe(channel, listener);
    cache.invalidate();
    await cache.load(channel);
    expect(fetch).toHaveBeenCalledTimes(2);
    cache.events([{ id: 1, type: "message", message: { ...message, id: 11 } }]);
    expect(cache.snapshot(channel).messages).toHaveLength(2);
    expect(listener.mock.calls.length).toBeLessThan(8);
    unsubscribe();
  });
  it("keeps stale history visible while revalidating and preserves navigation state", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(response([message])));
    vi.stubGlobal("fetch", fetch);
    const cache = new OrgCache(account);
    await cache.load(channel);
    cache.ui(channel).text = "Unsent draft";
    cache.ui(channel).scrollTop = 120;
    const pending = cache.load(channel, true);
    expect(cache.snapshot(channel).messages).toHaveLength(1);
    expect(cache.snapshot(channel).loading).toBe(true);
    await pending;
    expect(cache.ui(channel).text).toBe("Unsent draft");
    expect(cache.ui(channel).scrollTop).toBe(120);
  });
  it("bounds inactive views and clears data on disposal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(response([message]))),
    );
    const cache = new OrgCache(account);
    await cache.load(channel);
    for (let i = 0; i < 30; i++)
      await cache.load({ type: "channel", channelId: 100 + i });
    expect(cache.snapshot(channel).messages).toHaveLength(0);
    await cache.load(channel);
    cache.dispose();
    expect(cache.snapshot(channel).messages).toHaveLength(0);
  });
});

it("a forced reconciliation replaces an in-flight request without accepting its late response", async () => {
  let finish!: (r: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(response([{ ...message, id: 20 }]));
  vi.stubGlobal("fetch", fetch);
  const cache = new OrgCache(account);
  const old = cache.load(channel);
  await cache.load(channel, true);
  finish(response([message]));
  await old;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(cache.snapshot(channel).messages.map((m) => m.id)).toEqual([20]);
});
