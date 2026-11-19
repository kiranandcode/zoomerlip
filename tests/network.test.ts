// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { request, narrow, markThreadRead } from "../src/api";
const account = {
  url: "https://network-fixture.test",
  email: "test@test.invalid",
  apiKey: "fixture",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("uses modern DM operators with explicit legacy fallback", () => {
  expect(narrow({ type: "dm", userIds: [2] }, 177)[0].operator).toBe("dm");
  expect(narrow({ type: "dm", userIds: [2] }, 176)[0].operator).toBe("pm-with");
});
it("honours Retry-After before retrying a safe GET", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: "wait" }), {
        status: 429,
        headers: { "Retry-After": "2" },
      }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ result: "success" })));
  vi.stubGlobal("fetch", fetch);
  const pending = request(account, "/users/me");
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  await pending;
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("aborts a stalled request at its configured deadline", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options) =>
        new Promise((_r, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(options.signal.reason),
          ),
        ),
    ),
  );
  const p = request(
    { ...account, url: "https://timeout-fixture.test" },
    "/events",
    {},
    "GET",
    undefined,
    5000,
  );
  const check = expect(p).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(5000);
  await check;
});

it("marks every unread page without automatically retrying writes", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ found_oldest: false, first_processed_id: 90 }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ found_oldest: true, first_processed_id: 1 }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  await markThreadRead(
    { ...account, id: "test", name: "Test", userId: 1 },
    9,
    "Thread",
    new AbortController().signal,
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(new URLSearchParams(fetch.mock.calls[1][1].body).get("anchor")).toBe(
    "90",
  );
  expect(
    new URLSearchParams(fetch.mock.calls[1][1].body).get("include_anchor"),
  ).toBe("false");
});
it("signals terminal auth failure even for a non-JSON response", async () => {
  const listener = vi.fn();
  window.addEventListener("zoomerlip-auth-failed", listener);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })),
  );
  try {
    await expect(request(account, "/messages")).rejects.toMatchObject({
      status: 401,
    });
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener("zoomerlip-auth-failed", listener);
  }
});
