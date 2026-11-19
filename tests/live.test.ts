import { afterEach, expect, it, vi } from "vitest";
import { LiveStore, conversationKey } from "../src/live/store";
import { TypingSender } from "../src/live/typing";
import type { Account } from "../src/types";
const account = { id: "a", userId: 1 } as Account;
afterEach(() => vi.useRealTimers());
it("throttles actual input, orders stop after start, and stops after idle", async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockResolvedValue({});
  const sender = new TypingSender(send, 10000, 5000);
  sender.input();
  sender.input();
  await vi.advanceTimersByTimeAsync(4000);
  sender.input();
  await vi.advanceTimersByTimeAsync(4999);
  expect(send.mock.calls).toEqual([["start"]]);
  await vi.advanceTimersByTimeAsync(1);
  expect(send.mock.calls).toEqual([["start"], ["stop"]]);
  sender.input();
  sender.dispose();
  sender.input();
  await vi.runAllTimersAsync();
  expect(send.mock.calls).toEqual([["start"], ["stop"], ["start"], ["stop"]]);
});
it("isolates accounts and conversations, expires indicators, and invalidates on access loss", () => {
  const a = new LiveStore(),
    b = new LiveStore();
  a.register({ zulip_feature_level: 300 });
  a.events(
    [
      {
        id: 1,
        type: "typing",
        op: "start",
        message_type: "direct",
        sender: { user_id: 2 },
        recipients: [{ user_id: 1 }, { user_id: 2 }],
      },
    ],
    account,
  );
  expect(a.state.typing[0].key).toBe(
    conversationKey({ type: "dm", userIds: [2] }, 1),
  );
  expect(b.state.typing).toEqual([]);
  a.expire(Date.now() + 16000);
  expect(a.state.typing).toEqual([]);
  a.mergePresence({ "2": { active_timestamp: Date.now() / 1000 } });
  a.events([{ id: 2, type: "subscription", op: "remove" }], account);
  expect(a.state.presences).toEqual({});
  a.clear();
  expect(a.state.ready).toBe(false);
});
it("caps remote typing state and ignores own events", () => {
  const store = new LiveStore();
  store.register({});
  store.events(
    Array.from({ length: 300 }, (_, i) => ({
      id: i,
      type: "typing",
      op: "start",
      sender: { user_id: i + 1 },
      recipients: [],
    })),
    account,
  );
  expect(store.state.typing).toHaveLength(256);
  expect(store.state.typing.some((t) => t.user === 1)).toBe(false);
});

it("handles website/legacy and modern presence events without rolling newer events back", () => {
  const store = new LiveStore();
  store.register({ zulip_feature_level: 300 });
  store.events(
    [
      {
        id: 1,
        type: "presence",
        user_id: 2,
        presence: { website: { status: "active", timestamp: 1000 } },
      },
    ],
    account,
  );
  expect(store.state.presences[2].active_timestamp).toBe(1000);
  store.mergePresence({ 2: { active_timestamp: 900, idle_timestamp: 950 } });
  expect(store.state.presences[2].active_timestamp).toBe(1000);
  store.events(
    [
      {
        id: 2,
        type: "presence",
        presences: {
          2: { active_timestamp: 1100, idle_timestamp: 1100 },
          3: { idle_timestamp: 1050 },
        },
      },
    ],
    account,
  );
  expect(store.state.presences[3].idle_timestamp).toBe(1050);
  expect(store.state.presences[2].active_timestamp).toBe(1100);
});
