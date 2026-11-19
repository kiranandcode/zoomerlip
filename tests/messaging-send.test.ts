// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { request } from "../src/api";
import { sendComposition } from "../src/messaging/send";
import { destinationKey, listDrafts, saveDraft } from "../src/messaging/drafts";
vi.mock("../src/api", () => ({ request: vi.fn() }));
const account = {
  id: "fixture",
  url: "https://fixture.invalid",
  email: "fixture@test.invalid",
  apiKey: "fixture",
  name: "Fixture",
  userId: 1,
};
const view = { type: "channel" as const, channelId: 1, topic: "Thread" };
beforeEach(() => {
  localStorage.clear();
  vi.mocked(request).mockReset();
  saveDraft(account.id, {
    id: destinationKey(view),
    view,
    text: "draft",
    topic: "Thread",
    updated: 1,
  });
});
it("keeps a changed draft when a deliberate send completes", async () => {
  let finish: () => void = () => {};
  vi.mocked(request).mockImplementation(
    () =>
      new Promise((r) => {
        finish = () => r({ id: 1 });
      }),
  );
  const send = sendComposition(account, view, "draft", "Thread");
  await expect(
    sendComposition(account, view, "draft", "Thread"),
  ).rejects.toThrow("pending");
  saveDraft(account.id, {
    id: destinationKey(view),
    view,
    text: "new text",
    topic: "Thread",
    updated: 2,
  });
  finish();
  await send;
  expect(listDrafts(account.id)[0].text).toBe("new text");
  expect(request).toHaveBeenCalledTimes(1);
});
it("aborts on account revocation and never retries after reconnect", async () => {
  vi.mocked(request).mockImplementation(
    (_a, _p, _d, _m, signal) =>
      new Promise((_r, reject) =>
        signal!.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      ),
  );
  const send = sendComposition(account, view, "draft", "Thread");
  window.dispatchEvent(
    new CustomEvent("zoomerlip-messaging-reset", {
      detail: { accountId: account.id },
    }),
  );
  await expect(send).rejects.toThrow("Aborted");
  window.dispatchEvent(new Event("online"));
  expect(request).toHaveBeenCalledTimes(1);
});
it("clears an acknowledged unchanged draft", async () => {
  vi.mocked(request).mockResolvedValue({ id: 1 });
  await sendComposition(account, view, "draft", "Thread");
  expect(listDrafts(account.id)).toEqual([]);
});
