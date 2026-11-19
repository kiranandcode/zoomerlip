// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { startPresence } from "../src/live/presence";
import { LiveStore, presenceLabel } from "../src/live/store";
import type { Account } from "../src/types";
const account = {
  id: "https://presence.test|1",
  url: "https://presence.test",
  apiKey: "synthetic",
  email: "test@test.invalid",
  userId: 1,
} as Account;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("polls at most once per minute, sends real input and incremental cursor, and stops when hidden or disposed", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const fetch = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          result: "success",
          presence_last_update_id: 8,
          presences: { 2: { active_timestamp: Date.now() / 1000 } },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const store = new LiveStore();
  store.register({ zulip_feature_level: 300 });
  const control = new AbortController(),
    stop = startPresence(account, store, () => true, control.signal);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].body.get("last_update_id")).toBe("-1");
  await vi.advanceTimersByTimeAsync(50000);
  expect(fetch).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new KeyboardEvent("keydown"));
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(2);
  const body = fetch.mock.calls[1][1].body;
  expect(body.get("new_user_input")).toBe("true");
  expect(body.get("last_update_id")).toBe("8");
  expect(body.get("status")).toBe("active");
  expect(presenceLabel(store.state, 2)).toBe("Online");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await vi.advanceTimersByTimeAsync(120000);
  expect(fetch).toHaveBeenCalledTimes(2);
  stop();
  control.abort();
  await vi.advanceTimersByTimeAsync(120000);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("discards an in-flight response after private membership loss and falls back for older servers", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let resolve!: (value: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const store = new LiveStore();
  store.register({ zulip_feature_level: 177 });
  const control = new AbortController(),
    stop = startPresence(account, store, () => true, control.signal);
  expect(
    (
      fetch.mock.calls as unknown as [string, { body: URLSearchParams }][]
    )[0][1].body.get("slim_presence"),
  ).toBe("true");
  store.events([{ id: 1, type: "subscription", op: "remove" }], account);
  resolve(
    new Response(
      JSON.stringify({
        result: "success",
        presences: { 2: { active_timestamp: Date.now() / 1000 } },
      }),
    ),
  );
  await vi.advanceTimersByTimeAsync(1);
  expect(store.state.presences).toEqual({});
  stop();
  control.abort();
});
