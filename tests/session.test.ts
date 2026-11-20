import { expect, it } from "vitest";
import { SessionModel, topicKey } from "../src/sessionModel";
import type { Message } from "../src/types";
const message: Message = {
  id: 1,
  sender_id: 2,
  sender_full_name: "Muted",
  avatar_url: null,
  timestamp: 1,
  content: "hidden",
  type: "stream",
  stream_id: 9,
  subject: "thread",
  display_recipient: "private",
  reactions: [],
};
const registration = {
  queue_id: "q",
  last_event_id: -1,
  subscriptions: [
    { stream_id: 9, name: "private", description: "", invite_only: true },
  ],
  realm_users: [
    { user_id: 2, full_name: "Two", email: "", is_active: true, is_bot: false },
  ],
  muted_users: [{ id: 2 }],
  recent_private_conversations: [{ user_ids: [3], max_message_id: 90 }],
};
it("keeps organisation icons isolated and refreshes them from realm events", () => {
  const first = new SessionModel();
  const second = new SessionModel();
  first.register(
    { ...registration, realm_icon_url: "/icons/first.png" },
    "First",
  );
  second.register(
    { ...registration, realm_icon_url: "https://cdn.test/second.png" },
    "Second",
  );
  expect(first.state.iconUrl).toBe("/icons/first.png");
  first.apply(
    [
      {
        id: 1,
        type: "realm",
        op: "update_dict",
        property: "icon",
        data: { icon_url: "/icons/new.png", icon_source: "U" },
      },
    ],
    1,
  );
  expect(first.state.iconUrl).toBe("/icons/new.png");
  expect(second.state.iconUrl).toBe("https://cdn.test/second.png");
  first.apply(
    [
      {
        id: 2,
        type: "realm",
        op: "update",
        property: "name",
        value: "Renamed",
      },
    ],
    1,
  );
  expect(first.state.iconUrl).toBe("/icons/new.png");
  first.register(registration, "First");
  expect(first.state.iconUrl).toBe("");
});
it("uses server flags and mute state rather than counting every message", () => {
  const model = new SessionModel();
  model.register(registration, "Test");
  model.apply(
    [
      { id: 1, type: "message", message },
      {
        id: 2,
        type: "message",
        message: { ...message, id: 2, sender_id: 3 },
        flags: ["read"],
      },
      {
        id: 3,
        type: "message",
        message: { ...message, id: 3, sender_id: 3 },
        flags: [],
      },
    ],
    1,
  );
  expect(model.state.unread).toBe(1);
  expect(model.state.topicUnreads[topicKey(9, "thread")]).toBe(1);
  model.apply(
    [{ id: 4, type: "muted_users", muted_users: [{ id: 2 }, { id: 3 }] }],
    1,
  );
  expect(model.state.unread).toBe(0);
});
it("applies directory and realm deltas without network refetches", () => {
  const model = new SessionModel();
  model.register(registration, "Test");
  model.apply(
    [
      {
        id: 1,
        type: "realm_user",
        op: "update",
        person: { user_id: 2, full_name: "Changed" },
      },
      {
        id: 2,
        type: "realm",
        op: "update",
        property: "name",
        value: "Renamed",
      },
      {
        id: 3,
        type: "subscription",
        op: "remove",
        subscriptions: [{ stream_id: 9 }],
      },
    ],
    1,
  );
  expect(model.state.name).toBe("Renamed");
  expect(model.state.users[0].full_name).toBe("Changed");
  expect(model.state.channels).toEqual([]);
});
it("restores topic unread badges and removes them on read events", () => {
  const model = new SessionModel();
  model.register(
    {
      ...registration,
      unread_msgs: {
        streams: [
          { stream_id: 9, topic: "thread", unread_message_ids: [1, 2] },
        ],
      },
    },
    "Test",
  );
  expect(model.state.unread).toBe(2);
  model.apply(
    [
      {
        id: 1,
        type: "update_message_flags",
        flag: "read",
        op: "add",
        messages: [1],
      },
    ],
    1,
  );
  expect(model.state.topicUnreads[topicKey(9, "thread")]).toBe(1);
  model.apply(
    [
      {
        id: 2,
        type: "update_message_flags",
        flag: "read",
        op: "add",
        all: true,
        messages: [],
      },
    ],
    1,
  );
  expect(model.state.unread).toBe(0);
});
it("uses registered DM conversations even outside the latest message page", () => {
  const model = new SessionModel();
  model.register(registration, "Test");
  expect(model.state.recentConversations).toEqual([
    { user_ids: [3], max_message_id: 90 },
  ]);
  model.apply(
    [
      {
        id: 1,
        type: "message",
        message: {
          ...message,
          id: 100,
          type: "private",
          sender_id: 3,
          display_recipient: [
            { id: 1, email: "", full_name: "Me" },
            { id: 3, email: "", full_name: "Three" },
          ],
        },
      },
    ],
    1,
  );
  expect(model.state.recentConversations).toEqual([
    { user_ids: [3], max_message_id: 100 },
  ]);
});
it("recounts a moved unread message under its new topic", () => {
  const model = new SessionModel();
  model.register({ ...registration, muted_users: [] }, "Test");
  model.apply([{ id: 1, type: "message", message, flags: [] }], 1);
  expect(model.state.topicUnreads[topicKey(9, "thread")]).toBe(1);
  model.apply(
    [
      {
        id: 2,
        type: "update_message",
        message_id: 1,
        message_ids: [1],
        subject: "moved",
      },
    ],
    1,
  );
  expect(model.state.topicUnreads[topicKey(9, "thread")]).toBeUndefined();
  expect(model.state.topicUnreads[topicKey(9, "moved")]).toBe(1);
});

it("updates unread counts incrementally without touching old entries for normal traffic", () => {
  const model = new SessionModel();
  model.register(
    {
      ...registration,
      muted_users: [],
      unread_msgs: {
        streams: [
          {
            stream_id: 9,
            topic: "thread",
            unread_message_ids: Array.from({ length: 10000 }, (_, i) => i + 1),
          },
        ],
      },
    },
    "Test",
  );
  const old = model.state;
  model.apply(
    [
      {
        id: 1,
        type: "message",
        message: { ...message, id: 10001 },
        flags: ["read"],
      },
    ],
    1,
  );
  expect(model.state).toBe(old);
  model.apply(
    [{ id: 2, type: "message", message: { ...message, id: 10002 }, flags: [] }],
    1,
  );
  expect(model.state.unread).toBe(10001);
  expect(old.topicUnreads[topicKey(9, "thread")]).toBe(10000);
  model.apply(
    [{ id: 3, type: "message", message: { ...message, id: 10002 }, flags: [] }],
    1,
  );
  expect(model.state.unread).toBe(10001);
  model.apply(
    [
      {
        id: 4,
        type: "update_message_flags",
        flag: "read",
        op: "add",
        messages: [10002],
      },
    ],
    1,
  );
  expect(model.state.unread).toBe(10000);
});

it("applies mute policies in order within one batch and preserves topic badges", () => {
  const model = new SessionModel();
  model.register({ ...registration, muted_users: [] }, "Test");
  model.apply(
    [
      { id: 1, type: "message", message, flags: [] },
      {
        id: 2,
        type: "user_topic",
        stream_id: 9,
        topic_name: "thread",
        visibility_policy: 1,
      },
      { id: 3, type: "message", message: { ...message, id: 2 }, flags: [] },
    ],
    1,
  );
  expect(model.state.unread).toBe(0);
  expect(model.state.topicUnreads[topicKey(9, "thread")]).toBe(2);
  model.apply(
    [
      {
        id: 4,
        type: "user_topic",
        stream_id: 9,
        topic_name: "thread",
        visibility_policy: 2,
      },
    ],
    1,
  );
  expect(model.state.unread).toBe(2);
});
