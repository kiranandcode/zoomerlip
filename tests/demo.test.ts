import { describe, expect, it, vi, afterEach } from "vitest";
import { DemoServer, renderDemo } from "../src/demo/transport";
import { demoAccount } from "../src/demo/account";
import { request } from "../src/api";
import type { Message } from "../src/types";

const channel = [
  { operator: "stream", operand: 1 },
  { operator: "topic", operand: "Start here" },
];
const send = (s: DemoServer, content: string) =>
  s.request(
    "/messages",
    { type: "stream", to: 1, topic: "Start here", content },
    "POST",
  );
const messages = async (
  s: DemoServer,
  narrow: { operator: string; operand: unknown; negated?: boolean }[] = channel,
) =>
  (await s.request("/messages", { narrow, anchor: "newest", num_before: 100 }))
    .messages as Message[];
afterEach(() => vi.restoreAllMocks());
describe("browser-only demo", () => {
  it("never sends supported or unsupported demo requests to the network", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network forbidden"));
    await request(demoAccount, "/register", {}, "POST");
    await expect(
      request(demoAccount, "/user_uploads", new FormData(), "POST"),
    ).rejects.toThrow("connected organization");
    await expect(
      request(
        demoAccount,
        "/fetch_api_key",
        { password: "not-a-real-secret" },
        "POST",
      ),
    ).rejects.toThrow();
    const stopped = new AbortController();
    stopped.abort();
    await expect(
      request(demoAccount, "/messages", {}, "GET", stopped.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("isolates visitors and does not mutate returned snapshots", async () => {
    const one = new DemoServer(),
      two = new DemoServer();
    const initial = await messages(one);
    initial[0].content = "changed by caller";
    await send(one, "only in this tab");
    expect((await messages(one)).at(-1)?.content).toContain("only in this tab");
    expect(
      (await messages(two)).some((m) => m.content.includes("only in this tab")),
    ).toBe(false);
    expect((await messages(one))[0].content).not.toBe("changed by caller");
  });
  it("delivers sends and reactions through cancellable event queues", async () => {
    const s = new DemoServer();
    const registration = await s.request("/register", {}, "POST");
    const params = {
      queue_id: registration.queue_id,
      last_event_id: registration.last_event_id,
    };
    const events = s.request("/events", params);
    const { id } = await send(s, "hello");
    expect((await events).events).toMatchObject([
      { type: "message", message: { id } },
    ]);
    await s.request(
      `/messages/${id}/reactions`,
      {
        emoji_name: "heart",
        emoji_code: "2764",
        reaction_type: "unicode_emoji",
      },
      "POST",
    );
    expect((await messages(s)).at(-1)?.reactions).toHaveLength(1);
    await s.request(
      `/messages/${id}/reactions`,
      {
        emoji_name: "heart",
        emoji_code: "2764",
        reaction_type: "unicode_emoji",
      },
      "DELETE",
    );
    expect((await messages(s)).at(-1)?.reactions).toHaveLength(0);
    const abort = new AbortController();
    const poll = s.request(
      "/events",
      { ...params, last_event_id: 3 },
      "GET",
      abort.signal,
    );
    abort.abort();
    await expect(poll).rejects.toMatchObject({ name: "AbortError" });
  });
  it("keeps channel, topic and DM filters separate and paginates", async () => {
    const s = new DemoServer();
    const rows = await messages(s);
    expect(
      rows.every((m) => m.stream_id === 1 && m.subject === "Start here"),
    ).toBe(true);
    const dm = await messages(s, [{ operator: "dm", operand: [2] }]);
    expect(dm).toHaveLength(2);
    const { id } = await s.request(
      "/messages",
      { type: "private", to: [3], content: "private demo text" },
      "POST",
    );
    expect((await messages(s)).some((m) => m.id === id)).toBe(false);
    const page = await s.request("/messages", {
      narrow: channel,
      anchor: rows[2].id,
      include_anchor: false,
      num_before: 1,
      num_after: 1,
    });
    expect((page.messages as Message[]).map((m) => m.id)).toEqual([
      rows[1].id,
      rows[3].id,
    ]);
    expect(page.found_oldest).toBe(false);
    expect(page.found_newest).toBe(false);
  });
  it("renders arbitrary input as text, with no images or executable markup", async () => {
    const s = new DemoServer();
    await send(
      s,
      '<img src="https://outside.test/x" onerror="alert(1)"><script>bad()</script>',
    );
    const m = (await messages(s)).at(-1)!;
    expect(m.content).not.toContain("<img");
    expect(m.content).not.toContain("<script");
    expect(m.content).toContain("&lt;img");
    expect(renderDemo("**bold** `code`")).toContain("<strong>bold</strong>");
  });
  it("supports edits, stars, unread flags and deletion locally", async () => {
    const s = new DemoServer();
    const { id } = await send(s, "original");
    await s.request(`/messages/${id}`, { content: "edited" }, "PATCH");
    await s.request(
      "/messages/flags",
      { messages: [id], flag: "starred", op: "add" },
      "POST",
    );
    expect(
      await messages(s, [{ operator: "is", operand: "starred" }]),
    ).toMatchObject([{ id, content: "<p>edited</p>" }]);
    await s.request(
      "/messages/flags",
      { messages: [id], flag: "read", op: "remove" },
      "POST",
    );
    expect(
      await messages(s, [{ operator: "is", operand: "unread" }]),
    ).toHaveLength(1);
    await s.request(`/messages/${id}`, {}, "DELETE");
    expect((await messages(s)).some((m) => m.id === id)).toBe(false);
  });
});
