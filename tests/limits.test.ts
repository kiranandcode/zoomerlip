import { afterEach, expect, it, vi } from "vitest";
import { ApiError, MAX_RETRY_AFTER, pause, request } from "../src/api";
import { orgLabel } from "../src/orgLabel";
const account = {
  url: "https://org.test",
  email: "me@test.invalid",
  apiKey: "test",
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("caps a hostile Retry-After instead of overflowing the timer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: "error", msg: "Slow down" }), {
        status: 429,
        headers: { "Retry-After": "3000000" },
      }),
    ),
  );
  const error = await request(account, "/messages", {}, "POST").catch((e) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.retryAfterMs).toBe(MAX_RETRY_AFTER);
});
it("never schedules a pause that the browser would run immediately", async () => {
  vi.useFakeTimers();
  let done = false;
  void pause(2 ** 40).then(() => (done = true));
  await vi.advanceTimersByTimeAsync(1000);
  expect(done).toBe(false);
});
it("labels organizations with the hostname the user chose", () => {
  expect(orgLabel("Acme", "https://chat.acme.test")).toBe(
    "Acme (chat.acme.test)",
  );
  expect(orgLabel("", "https://chat.acme.test")).toBe("chat.acme.test");
  expect(orgLabel("Acme", "http://localhost:8080")).toBe(
    "Acme (localhost:8080)",
  );
});
