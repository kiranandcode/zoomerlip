import { beforeEach, expect, it, vi } from "vitest";
import { request } from "../src/api";
import { setMessagingCapabilities } from "../src/messaging/capabilities";
import {
  futureTimestamp,
  listProductivity,
  rescheduleReminder,
} from "../src/messaging/productivity";
vi.mock("../src/api", () => ({ request: vi.fn() }));
const account = {
  id: "fixture",
  url: "https://fixture.invalid",
  email: "fixture@test.invalid",
  apiKey: "fixture",
  name: "Fixture",
  userId: 1,
};
beforeEach(() => {
  vi.mocked(request).mockReset();
  setMessagingCapabilities(account.id, { zulip_feature_level: 420 });
});
it("rejects past/invalid dates and converts future local input to seconds", () => {
  expect(() => futureTimestamp("bad")).toThrow();
  expect(() => futureTimestamp("2020-01-01T12:00")).toThrow();
  const input = "2090-01-01T12:00";
  expect(futureTimestamp(input)).toBe(new Date(input).getTime() / 1000);
});
it("feature-gates server lists without requests", async () => {
  setMessagingCapabilities(account.id, { zulip_feature_level: 100 });
  await expect(
    listProductivity(
      account,
      "scheduled_messages",
      new AbortController().signal,
    ),
  ).rejects.toThrow("feature level");
  expect(request).not.toHaveBeenCalled();
});
it("keeps the original reminder when replacement creation fails", async () => {
  vi.mocked(request).mockRejectedValue(new Error("offline"));
  await expect(
    rescheduleReminder(
      account,
      { id: 1, content: "original", reminder_target_message_id: 9 },
      "2090-01-01T12:00",
      "",
      new AbortController().signal,
    ),
  ).rejects.toThrow("offline");
  expect(request).toHaveBeenCalledTimes(1);
});
it("reports both reminder IDs after partial replacement failure", async () => {
  vi.mocked(request)
    .mockResolvedValueOnce({ reminder_id: 2 })
    .mockRejectedValueOnce(new Error("denied"));
  await expect(
    rescheduleReminder(
      account,
      { id: 1, content: "original", reminder_target_message_id: 9 },
      "2090-01-01T12:00",
      "",
      new AbortController().signal,
    ),
  ).rejects.toThrow("Replacement reminder 2 was created, but old reminder 1");
});
