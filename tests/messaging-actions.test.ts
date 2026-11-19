import { expect, it } from "vitest";
import { applyMessageEvent } from "../src/cache";
import { messageLink, quoteMessage } from "../src/messaging/actions";
import type { Account, Message } from "../src/types";
const account = { url: "https://fixture.invalid" } as Account;
const message = {
  id: 9,
  sender_full_name: "Fixture",
  flags: ["read"],
  reactions: [],
} as unknown as Message;
it("uses credential-free stable message links and quotes raw Markdown", () => {
  expect(messageLink(account, message)).toBe(
    "https://fixture.invalid/#narrow/id/9",
  );
  expect(quoteMessage(account, message, "**hello**\nsecond")).toContain(
    "> **hello**\n> second",
  );
});
it("applies star/unread events without losing other flags", () => {
  const view = { type: "channel" as const, channelId: 1 };
  let messages = applyMessageEvent(
    [message],
    {
      id: 1,
      type: "update_message_flags",
      messages: [9],
      flag: "starred",
      op: "add",
    },
    view,
    1,
  );
  expect(messages[0].flags).toEqual(["read", "starred"]);
  messages = applyMessageEvent(
    messages,
    {
      id: 2,
      type: "update_message_flags",
      messages: [9],
      flag: "read",
      op: "remove",
    },
    view,
    1,
  );
  expect(messages[0].flags).toEqual(["starred"]);
  messages = applyMessageEvent(
    messages,
    {
      id: 3,
      type: "update_message_flags",
      messages: [8],
      flag: "starred",
      op: "remove",
    },
    view,
    1,
  );
  expect(messages[0].flags).toEqual(["starred"]);
});
