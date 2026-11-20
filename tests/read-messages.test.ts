// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { trackReadMessages } from "../src/readMessages";

let cleanup: (() => void) | undefined;
let focused = true,
  covered = false,
  enabled = true;
beforeEach(() => {
  vi.useFakeTimers();
  focused = enabled = true;
  covered = false;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    window.setTimeout(() => fn(0), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", window.clearTimeout.bind(window));
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup(send = vi.fn().mockResolvedValue(undefined)) {
  const root = document.createElement("div");
  document.body.append(root);
  const rect = (top: number, height: number) =>
    ({
      top,
      bottom: top + height,
      left: 0,
      right: 400,
      width: 400,
      height,
    }) as DOMRect;
  root.getBoundingClientRect = () => rect(100, 120);
  for (let id = 1; id <= 10; id++) {
    const row = document.createElement("article");
    row.dataset.messageId = String(id);
    row.getBoundingClientRect = () =>
      rect(100 + (id - 1) * 40 - root.scrollTop, 40);
    root.append(row);
  }
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: (_x: number, y: number) =>
      covered
        ? document.body
        : [...root.children].find((row) => {
            const r = row.getBoundingClientRect();
            return r.top <= y && r.bottom > y;
          }),
  });
  const unread = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const error = vi.fn();
  const tracker = trackReadMessages(
    root,
    () => unread,
    send,
    error,
    () => enabled,
  );
  cleanup = tracker.dispose;
  return { root, unread, send, error, tracker };
}
it("batches only visible unread rows after dwelling; loaded offscreen rows stay unread", async () => {
  const { send } = setup();
  await vi.advanceTimersByTimeAsync(500);
  expect(send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200);
  expect(send.mock.calls[0][0]).toEqual([2, 3]);
  await vi.advanceTimersByTimeAsync(3000);
  expect(send).toHaveBeenCalledTimes(1);
});
it.each(["blur", "hidden", "drawer", "covered"])(
  "never reads while %s",
  async (reason) => {
    const { send, tracker } = setup();
    if (reason === "blur") focused = false;
    if (reason === "hidden")
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    if (reason === "drawer") enabled = false;
    if (reason === "covered") covered = true;
    tracker.refresh();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).not.toHaveBeenCalled();
  },
);
it("requires a fresh dwell after a tab returns to the foreground", async () => {
  const { send } = setup();
  await vi.advanceTimersByTimeAsync(400);
  focused = false;
  window.dispatchEvent(new Event("blur"));
  await vi.advanceTimersByTimeAsync(1000);
  focused = true;
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(400);
  expect(send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300);
  expect(send).toHaveBeenCalledTimes(1);
});
it("does not undo mark-unread while the message remains visible", async () => {
  const { root, unread, send, tracker } = setup();
  await vi.advanceTimersByTimeAsync(700);
  unread.add(1);
  tracker.refresh();
  await vi.advanceTimersByTimeAsync(1000);
  expect(send).toHaveBeenCalledTimes(1);
  root.scrollTop = 200;
  root.dispatchEvent(new Event("scroll"));
  await vi.advanceTimersByTimeAsync(50);
  root.scrollTop = 0;
  root.dispatchEvent(new Event("scroll"));
  await vi.advanceTimersByTimeAsync(700);
  expect(send.mock.calls.at(-1)?.[0]).toEqual([1, 2, 3]);
});
it("backs off failed writes without clearing unread state", async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  const { error, unread } = setup(send);
  await vi.advanceTimersByTimeAsync(700);
  expect(error).toHaveBeenCalledTimes(1);
  expect(unread.has(2)).toBe(true);
  await vi.advanceTimersByTimeAsync(4000);
  expect(send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1100);
  expect(send).toHaveBeenCalledTimes(2);
});
it("cancels pending work on account or conversation removal", async () => {
  const send = vi.fn(() => new Promise(() => {}));
  const { tracker } = setup(send);
  await vi.advanceTimersByTimeAsync(700);
  const signal = (send.mock.calls[0] as unknown as [number[], AbortSignal])[1];
  tracker.dispose();
  expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(send).toHaveBeenCalledTimes(1);
});
