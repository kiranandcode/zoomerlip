import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptySearch,
  messageContext,
  searchMessages,
  searchNarrow,
  messageView,
} from "../src/organisation/search";
import type { Account, Message } from "../src/types";
const account: Account = {
  id: "fixture",
  url: "https://fixture.invalid",
  email: "a@fixture.invalid",
  apiKey: "test",
  name: "Fixture",
  userId: 1,
};
const msg = (id: number): Message => ({
  id,
  type: "stream",
  stream_id: 2,
  subject: "Topic",
  content: "<p>body</p>",
  sender_id: 1,
  sender_full_name: "A",
  timestamp: 1,
  avatar_url: null,
  display_recipient: "Channel",
  reactions: [],
});
afterEach(() => vi.unstubAllGlobals());
describe("search", () => {
  it("encodes text as one operand and supports each filter without parsing injection", () => {
    expect(
      searchNarrow({
        ...emptySearch,
        text: "hello sender:other",
        sender: "a@example.com",
        channel: "2",
        topic: "a:b",
        after: "2026-01-01",
        before: "2026-02-01",
        attachment: true,
        special: "mentioned",
      }),
    ).toEqual([
      { operator: "search", operand: "hello sender:other" },
      { operator: "sender", operand: "a@example.com" },
      { operator: "stream", operand: 2 },
      { operator: "topic", operand: "a:b" },
      { operator: "after", operand: "2026-01-01" },
      { operator: "before", operand: "2026-02-01" },
      { operator: "has", operand: "attachment" },
      { operator: "is", operand: "mentioned" },
    ]);
    expect(() => searchNarrow({ ...emptySearch, after: "bad" })).toThrow();
    expect(() =>
      searchNarrow({
        ...emptySearch,
        after: "2026-02-01",
        before: "2026-01-01",
      }),
    ).toThrow();
  });
  it("pages exclusively, deduplicates and detects a nonadvancing server", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [msg(49), msg(50), msg(49), msg(48)],
          found_oldest: false,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const page = await searchMessages(
      account,
      emptySearch,
      50,
      new AbortController().signal,
    );
    expect(page.messages.map((m) => m.id)).toEqual([49, 48]);
    expect(page.cursor).toBe(48);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get("include_anchor")).toBe("false");
    expect(url.searchParams.get("num_before")).toBe("50");
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({ messages: [msg(50)], found_oldest: false }),
      ),
    );
    await expect(
      searchMessages(account, emptySearch, 50, new AbortController().signal),
    ).rejects.toThrow("did not advance");
  });
  it("cancels stale work and keeps credentials only on the account origin", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [], found_oldest: true })),
      );
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchMessages(account, emptySearch, undefined, controller.signal),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await searchMessages(
      account,
      emptySearch,
      undefined,
      new AbortController().signal,
    );
    expect(new URL(fetcher.mock.calls[0][0]).origin).toBe(account.url);
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });
  it("rechecks a moved result before fetching bounded context", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: { ...msg(4), stream_id: 8, subject: "Moved" },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [msg(4)] })),
      );
    vi.stubGlobal("fetch", fetcher);
    const result = await messageContext(
      account,
      msg(4),
      177,
      new AbortController().signal,
    );
    expect(result.view).toEqual({
      type: "channel",
      channelId: 8,
      topic: "Moved",
    });
    const params = new URL(fetcher.mock.calls[1][0]).searchParams;
    expect(JSON.parse(params.get("narrow")!)[0].operand).toBe(8);
    expect(params.get("num_after")).toBe("25");
    expect(
      messageView(
        {
          ...msg(3),
          type: "private",
          display_recipient: [{ id: 1, full_name: "A", email: "a" }],
        },
        1,
      ),
    ).toEqual({ type: "dm", userIds: [1] });
  });
});
