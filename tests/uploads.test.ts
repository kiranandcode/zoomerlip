import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../src/api";
import { clearUploadCache, resolveUpload } from "../src/uploads";
import type { Account } from "../src/types";
vi.mock("../src/api", () => ({ request: vi.fn() }));
const account: Account = {
  id: "uploads-fixture",
  url: "https://org.test",
  email: "one@test.invalid",
  apiKey: "fixture-key",
  name: "Test",
  userId: 1,
};
type Call = {
  account: Account;
  path: string;
  signal: AbortSignal;
  finish: (url?: string) => void;
  settled: boolean;
};
let calls: Call[] = [],
  active = 0,
  peak = 0;
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function start(path: string, as = account, controller = new AbortController()) {
  const promise = resolveUpload(as, path, controller.signal);
  void promise.catch(() => {});
  return { promise, controller };
}
async function finishAll() {
  for (let i = 0; i < 10; i++) {
    for (const call of calls) if (!call.settled) call.finish();
    await tick();
  }
}
beforeEach(() => {
  calls = [];
  active = 0;
  peak = 0;
  vi.mocked(request)
    .mockReset()
    .mockImplementation(
      (as, path, _params, _method, signal) =>
        new Promise((resolve) => {
          active++;
          peak = Math.max(peak, active);
          const call: Call = {
            account: as as Account,
            path,
            signal: signal!,
            settled: false,
            finish: (url = "https://cdn.test/signed-image") => {
              if (call.settled) return;
              call.settled = true;
              active--;
              resolve({ url });
            },
          };
          calls.push(call);
        }),
    );
});
afterEach(async () => {
  clearUploadCache(account.id);
  clearUploadCache("other-account");
  await finishAll();
});
describe("private upload resolution", () => {
  it("reserves slots for queued jobs so a newcomer cannot exceed three requests", async () => {
    const jobs = Array.from({ length: 4 }, (_, i) =>
      start(`/user_uploads/${i}`),
    );
    await tick();
    expect(calls).toHaveLength(3);
    calls[0].finish();
    queueMicrotask(() => jobs.push(start("/user_uploads/newcomer")));
    await tick();
    expect(peak).toBe(3);
    expect(active).toBe(3);
    await finishAll();
    await Promise.all(jobs.map((j) => j.promise));
    expect(calls).toHaveLength(5);
  });
  it("shares one in-flight request while one subscriber cancels", async () => {
    const a = start("/user_uploads/shared"),
      b = start("/user_uploads/shared");
    await tick();
    expect(calls).toHaveLength(1);
    a.controller.abort();
    await expect(a.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(calls[0].signal.aborted).toBe(false);
    calls[0].finish();
    await expect(b.promise).resolves.toBe("https://cdn.test/signed-image");
  });
  it("aborts a shared request only after every subscriber cancels", async () => {
    const a = start("/user_uploads/shared"),
      b = start("/user_uploads/shared");
    await tick();
    a.controller.abort();
    b.controller.abort();
    await Promise.allSettled([a.promise, b.promise]);
    expect(calls[0].signal.aborted).toBe(true);
  });
  it("removes cancelled queued work without starting another request or leaking its slot", async () => {
    const busy = Array.from({ length: 3 }, (_, i) =>
      start(`/user_uploads/${i}`),
    );
    const cancelled = start("/user_uploads/cancelled"),
      last = start("/user_uploads/last");
    await tick();
    cancelled.controller.abort();
    await expect(cancelled.promise).rejects.toMatchObject({
      name: "AbortError",
    });
    calls[0].finish();
    await tick();
    expect(calls.map((c) => c.path)).not.toContain("/user_uploads/cancelled");
    expect(calls.at(-1)?.path).toBe("/user_uploads/last");
    await finishAll();
    await Promise.all([...busy.map((j) => j.promise), last.promise]);
    expect(peak).toBe(3);
  });
  it("does not cache completed temporary URLs", async () => {
    const a = start("/user_uploads/shared");
    await tick();
    calls[0].finish("https://cdn.test/first");
    await a.promise;
    const b = start("/user_uploads/shared");
    await tick();
    expect(calls).toHaveLength(2);
    calls[1].finish("https://cdn.test/second");
    await expect(b.promise).resolves.toBe("https://cdn.test/second");
  });
  it.each([{ apiKey: "new-key" }, { email: "renamed@test.invalid" }])(
    "isolates a credential change: %j",
    async (change) => {
      const old = start("/user_uploads/shared");
      await tick();
      const current = start("/user_uploads/shared", { ...account, ...change });
      await tick();
      expect(calls).toHaveLength(2);
      expect(calls[0].signal.aborted).toBe(true);
      let oldSettled = false;
      void old.promise.catch(() => {
        oldSettled = true;
      });
      await tick();
      expect(oldSettled).toBe(true);
      calls[0].finish("https://cdn.test/stale");
      calls[1].finish("https://cdn.test/current");
      await expect(old.promise).rejects.toMatchObject({ name: "AbortError" });
      await expect(current.promise).resolves.toBe("https://cdn.test/current");
    },
  );
  it("revokes active and queued consumers immediately on account removal", async () => {
    const jobs = Array.from({ length: 4 }, (_, i) =>
      start(`/user_uploads/${i}`),
    );
    await tick();
    clearUploadCache(account.id);
    let settled = 0;
    for (const job of jobs)
      void job.promise.catch(() => {
        settled++;
      });
    await tick();
    expect(settled).toBe(4);
    expect(calls.every((c) => c.signal.aborted)).toBe(true);
    await finishAll();
    expect(calls).toHaveLength(3);
  });
  it("never shares paths across accounts", async () => {
    const a = start("/user_uploads/shared"),
      b = start("/user_uploads/shared", {
        ...account,
        id: "other-account",
        userId: 2,
      });
    await tick();
    expect(calls).toHaveLength(2);
    await finishAll();
    await Promise.all([a.promise, b.promise]);
  });
  it("does not enqueue an already cancelled consumer", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      start("/user_uploads/nope", account, controller).promise,
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(0);
  });
});
