// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import {
  clearDrafts,
  destinationKey,
  draftFor,
  listDrafts,
  MAX_DRAFT_TEXT,
  persistDraft,
  saveDraft,
  syncDrafts,
  validDraft,
} from "../src/messaging/drafts";
import type { Draft } from "../src/messaging/drafts";
import { request } from "../src/api";
vi.mock("../src/api", () => ({
  request: vi.fn(),
  ApiError: class extends Error {},
}));
const view = { type: "channel" as const, channelId: 4, topic: "test" };
const draft: Draft = {
  id: destinationKey(view),
  view,
  text: "private fixture",
  topic: "test",
  updated: 1,
};
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
it("isolates accounts and destinations and validates stored records", () => {
  saveDraft("one", draft);
  expect(draftFor("one", view)?.text).toBe(draft.text);
  expect(listDrafts("two")).toEqual([]);
  expect(validDraft({ ...draft, text: "x".repeat(MAX_DRAFT_TEXT + 1) })).toBe(
    false,
  );
  expect(validDraft({ ...draft, view: { type: "dm", userIds: [-1] } })).toBe(
    false,
  );
  expect(destinationKey({ type: "dm", userIds: [2, 1, 2] })).toBe(
    destinationKey({ type: "dm", userIds: [1, 2] }),
  );
});
it("preserves another tab's conflicting version", () => {
  saveDraft("one", draft);
  persistDraft("one", { ...draft, text: "new version" }, "stale text");
  expect(
    listDrafts("one")
      .map((d) => d.text)
      .sort(),
  ).toEqual(["new version", "private fixture"]);
});
it("clears only revoked channels then all account drafts", () => {
  saveDraft("one", draft);
  saveDraft("two", draft);
  saveDraft("one", { ...draft, id: "dm", view: { type: "dm", userIds: [2] } });
  clearDrafts("one", [4]);
  expect(listDrafts("one").map((d) => d.id)).toEqual(["dm"]);
  clearDrafts("one");
  expect(listDrafts("one")).toEqual([]);
  expect(listDrafts("two")).toHaveLength(1);
});
it("syncs distinct copies without updating or sending either version", async () => {
  saveDraft("one", draft);
  vi.mocked(request)
    .mockResolvedValueOnce({
      drafts: [
        {
          id: 9,
          type: "stream",
          to: [4],
          topic: "test",
          content: "server version",
          timestamp: 1,
        },
      ],
    })
    .mockResolvedValue({ ids: [10] });
  const account = {
    id: "one",
    url: "https://fixture.invalid",
    userId: 1,
    email: "fixture@test.invalid",
    apiKey: "fixture",
    name: "Fixture",
  };
  await syncDrafts(account, new AbortController().signal);
  expect(
    listDrafts("one")
      .map((d) => d.text)
      .sort(),
  ).toEqual(["private fixture", "server version"]);
  expect(vi.mocked(request).mock.calls.map((c) => [c[1], c[3]])).toEqual([
    ["/drafts", "GET"],
    ["/drafts", "POST"],
  ]);
});
it("retains drafts if quota or network fails", async () => {
  saveDraft("one", draft);
  expect(() =>
    saveDraft("one", { ...draft, text: "x".repeat(MAX_DRAFT_TEXT + 1) }),
  ).toThrow();
  vi.mocked(request).mockRejectedValue(new Error("offline"));
  await expect(
    syncDrafts({ id: "one" } as never, new AbortController().signal),
  ).rejects.toThrow("offline");
  expect(listDrafts("one")[0].text).toBe(draft.text);
});
