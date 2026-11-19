// @vitest-environment jsdom
import { expect, it } from "vitest";
import { readingAnchor, restoreAnchor } from "../src/scrollAnchor";

// Deterministic row geometry: no browser, server, or real organization is used.
function scroller(ids: number[]) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  ids.forEach((id, index) => {
    const row = document.createElement("article");
    row.dataset.messageId = String(id);
    row.getBoundingClientRect = () =>
      ({
        top: 100 + index * 40 - el.scrollTop,
        bottom: 100 + (index + 1) * 40 - el.scrollTop,
      }) as DOMRect;
    el.appendChild(row);
  });
  return el;
}

it.each([false, true])(
  "restores the reading row after hidden retention trims rows (profile=%s)",
  (profile) => {
    const ids = Array.from({ length: 600 }, (_, i) => i + 1);
    if (profile) ids.reverse();
    const before = scroller(ids);
    before.scrollTop = ids.indexOf(400) * 40 + 12;
    const saved = readingAnchor(before)!;
    expect(saved).toEqual({ id: "400", top: -12 });
    const retained = scroller(ids.filter((id) => id >= 250 && id < 550));
    expect(restoreAnchor(retained, saved)).toBe(true);
    expect(readingAnchor(retained)).toEqual(saved);
    expect(retained.scrollTop).not.toBe(before.scrollTop);
  },
);

it("does not invent a scroll target when the saved row was deleted", () => {
  const el = scroller([1, 2]);
  el.scrollTop = 12;
  expect(restoreAnchor(el, { id: "3", top: -12 })).toBe(false);
  expect(el.scrollTop).toBe(12);
});
