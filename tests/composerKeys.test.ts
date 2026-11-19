import { expect, it } from "vitest";
import { sendsOnEnter } from "../src/composerKeys";
const key = (over: Partial<Parameters<typeof sendsOnEnter>[0]> = {}) => ({
  key: "Enter",
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
  ...over,
});
it("adds a line on a touch keyboard, which has no Shift+Enter", () => {
  expect(sendsOnEnter(key(), true)).toBe(false);
  expect(sendsOnEnter(key({ ctrlKey: true }), true)).toBe(true);
});
it("keeps Enter to send and Shift+Enter for a line on a desktop keyboard", () => {
  expect(sendsOnEnter(key(), false)).toBe(true);
  expect(sendsOnEnter(key({ shiftKey: true }), false)).toBe(false);
  expect(sendsOnEnter(key({ metaKey: true }), false)).toBe(true);
});
it("never sends while an input method is composing", () => {
  expect(sendsOnEnter(key({ isComposing: true }), false)).toBe(false);
  expect(sendsOnEnter(key({ key: "a" }), false)).toBe(false);
});
