// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  claimNotification,
  notificationText,
  NotificationDelivery,
} from "../src/notifications/delivery";
import {
  defaults,
  ledgerKey,
  readPreferences,
  savePreferences,
} from "../src/notifications/preferences";
import { notificationRule } from "../src/notifications/policy";
import { initialSession, topicKey } from "../src/sessionModel";
import { liveStore } from "../src/live/store";
import {
  validNotificationTarget,
  messageView,
} from "../src/notifications/navigation";
import type { Account, Message } from "../src/types";
const account = {
  id: "https://test.example|1",
  url: "https://test.example",
  userId: 1,
} as Account;
const message: Message = {
  id: 55,
  sender_id: 2,
  sender_full_name: "Secret Sender",
  type: "stream",
  stream_id: 5,
  subject: "private",
  content: "Secret content",
  timestamp: Date.now() / 1000,
  avatar_url: null,
  display_recipient: "channel",
  reactions: [],
  flags: [],
};
const session = {
  ...initialSession,
  ready: true,
  channels: [{ stream_id: 5, name: "c", description: "" }],
};
const prefs = { ...defaults, enabled: true, sound: true };
const context = {
  session,
  settings: {
    enable_desktop_notifications: true,
    enable_sounds: true,
    enable_stream_desktop_notifications: true,
    enable_followed_topic_desktop_notifications: true,
  },
  followed: [],
  localMutes: {},
};
afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("applies mute, follow, mention, own and read precedence", () => {
  expect(notificationRule(account, message, prefs, context).visual).toBe(true);
  for (const patch of [{ sender_id: 1 }, { flags: ["read"] }])
    expect(
      notificationRule(account, { ...message, ...patch }, prefs, context)
        .visual,
    ).toBe(false);
  const muted = {
    ...context,
    session: {
      ...session,
      channels: [{ ...session.channels[0], is_muted: true }],
    },
  };
  expect(notificationRule(account, message, prefs, muted).visual).toBe(false);
  expect(
    notificationRule(
      account,
      { ...message, flags: ["mentioned"] },
      prefs,
      muted,
    ).visual,
  ).toBe(true);
  expect(
    notificationRule(account, message, prefs, {
      ...muted,
      followed: [topicKey(5, "private")],
      session: { ...muted.session, unmutedTopics: [topicKey(5, "private")] },
    }).visual,
  ).toBe(true);
  expect(
    notificationRule(account, { ...message, flags: ["mentioned"] }, prefs, {
      ...context,
      localMutes: { [topicKey(5, "private")]: {} },
    }).visual,
  ).toBe(false);
  expect(
    notificationRule(
      account,
      { ...message, type: "private" },
      { ...prefs, dms: false },
      context,
    ).visual,
  ).toBe(false);
});
it("keeps previews private and validates saved settings and navigation", () => {
  expect(notificationText(message, true)).toEqual({
    title: "Zoomerlip",
    body: "New message. Open Zoomerlip to read it.",
  });
  savePreferences(account.id, prefs);
  expect(readPreferences(account.id)).toEqual(prefs);
  expect(
    validNotificationTarget({
      accountId: account.id,
      messageId: "https://evil.example",
    }),
  ).toBe(false);
  expect(
    validNotificationTarget({ accountId: account.id, messageId: 55 }),
  ).toBe(true);
  expect(messageView(message, account)).toEqual({
    type: "channel",
    channelId: 5,
    topic: "private",
  });
});
it("serializes competing tab claims, bounds ledger and fails closed on storage errors", async () => {
  let chain = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: (_: string, fn: () => void) => (chain = chain.then(fn)) },
  });
  const deliver = vi.fn(() => true);
  await Promise.all([
    claimNotification(account.id, 55, deliver),
    claimNotification(account.id, 55, deliver),
  ]);
  expect(deliver).toHaveBeenCalledTimes(1);
  localStorage.setItem(
    ledgerKey(account.id),
    JSON.stringify(Array.from({ length: 512 }, (_, i) => i)),
  );
  await claimNotification(account.id, 600, deliver);
  expect(JSON.parse(localStorage.getItem(ledgerKey(account.id))!)).toHaveLength(
    512,
  );
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  await claimNotification(account.id, 700, deliver);
  expect(deliver).toHaveBeenCalledTimes(2);
});
it("cancels delayed notifications on read, membership loss and disposal", async () => {
  vi.useFakeTimers();
  savePreferences(account.id, prefs);
  const store = liveStore(account.id);
  store.register({ zulip_feature_level: 300, user_settings: context.settings });
  const delivery = new NotificationDelivery(
    account,
    () => session,
    () => false,
  );
  const fake = vi.fn(function () {
    return { close() {} };
  });
  Object.defineProperty(fake, "permission", { value: "granted" });
  vi.stubGlobal("Notification", fake);
  for (const cancel of [
    { type: "update_message_flags", op: "add", flag: "read", messages: [55] },
    { type: "subscription", op: "remove" },
  ]) {
    delivery.events([
      { id: 1, type: "message", message },
      { id: 2, ...cancel },
    ]);
    await vi.advanceTimersByTimeAsync(1000);
  }
  delivery.events([
    { id: 3, type: "message", message: { ...message, id: 56 } },
  ]);
  delivery.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fake).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
