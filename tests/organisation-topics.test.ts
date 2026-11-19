import { afterEach, expect, it, vi } from "vitest";
import { canTopic, inGroup } from "../src/organisation/permissions";
import type { Access } from "../src/organisation/permissions";
import { moveTopic, setTopicPolicy } from "../src/organisation/topics";
import { SessionModel } from "../src/sessionModel";
const account = {
  id: "test",
  url: "https://fixture.invalid",
  email: "a@fixture.invalid",
  apiKey: "test",
  userId: 1,
  name: "Fixture",
};
const channel = { stream_id: 2, name: "Test", description: "" };
const access: Access = {
  featureLevel: 367,
  me: {
    user_id: 1,
    full_name: "A",
    email: "a",
    is_active: true,
    is_bot: false,
    role: 400,
  },
  settings: {
    realm_can_move_messages_between_topics_group: {
      direct_members: [1],
      direct_subgroups: [],
    },
    realm_can_move_messages_between_channels_group: 8,
    realm_can_resolve_topics_group: {
      direct_members: [1],
      direct_subgroups: [],
    },
  },
  groups: [],
};
const message = {
  id: 1,
  type: "stream" as const,
  stream_id: 2,
  subject: "Topic",
  content: "",
  timestamp: Date.now() / 1000,
  sender_id: 1,
  sender_full_name: "A",
  avatar_url: null,
  display_recipient: "Test",
  reactions: [],
};
afterEach(() => vi.unstubAllGlobals());
it("fails closed for unknown permission groups and handles nested cycles", () => {
  expect(canTopic(access, channel, "move")).toBe(false);
  expect(canTopic(access, channel, "rename")).toBe(true);
  expect(
    inGroup(
      {
        ...access,
        groups: [
          {
            id: 8,
            name: "a",
            description: "",
            members: [],
            direct_subgroups: [9],
          },
          {
            id: 9,
            name: "b",
            description: "",
            members: [],
            direct_subgroups: [8],
          },
        ],
      },
      8,
    ),
  ).toBe(false);
  expect(
    inGroup(
      {
        ...access,
        groups: [
          {
            id: 8,
            name: "a",
            description: "",
            members: [],
            direct_subgroups: [9],
          },
          { id: 9, name: "b", description: "", members: [1] },
        ],
      },
      8,
    ),
  ).toBe(true);
});
it("gates following and sends exact server topic policies", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response('{"result":"success"}')),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    setTopicPolicy(account, 2, "Topic", 3, 218, new AbortController().signal),
  ).rejects.toThrow("does not support");
  expect(fetcher).not.toHaveBeenCalled();
  await setTopicPolicy(
    account,
    2,
    "Topic",
    3,
    219,
    new AbortController().signal,
  );
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://fixture.invalid/api/v1/user_topics",
  );
  expect(fetcher.mock.calls[0][1].body.get("visibility_policy")).toBe("3");
});
it("moves exactly the selected scope, denies permission and expired edits", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response('{"result":"success"}')),
    );
  vi.stubGlobal("fetch", fetcher);
  await moveTopic(
    account,
    access,
    channel,
    message,
    2,
    "Renamed",
    "change_later",
    false,
    new AbortController().signal,
  );
  const body = fetcher.mock.calls[0][1].body;
  expect(body.get("propagate_mode")).toBe("change_later");
  expect(body.has("stream_id")).toBe(false);
  expect(body.get("send_notification_to_new_thread")).toBe("false");
  await expect(
    moveTopic(
      account,
      access,
      channel,
      message,
      9,
      "Renamed",
      "change_all",
      false,
      new AbortController().signal,
    ),
  ).rejects.toThrow("permissions");
  await expect(
    moveTopic(
      account,
      {
        ...access,
        settings: {
          ...access.settings,
          realm_move_messages_within_stream_limit_seconds: 10,
        },
      },
      channel,
      { ...message, timestamp: 0 },
      2,
      "Renamed",
      "change_all",
      false,
      new AbortController().signal,
    ),
  ).rejects.toThrow("time limit");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("tracks follow events and realm policy revocation", () => {
  const model = new SessionModel();
  model.register(
    {
      queue_id: "q",
      last_event_id: 0,
      zulip_feature_level: 367,
      realm_can_resolve_topics_group: 3,
      user_topics: [
        { stream_id: 2, topic_name: "Topic", visibility_policy: 3 },
      ],
    },
    "Fixture",
  );
  expect(model.state.followedTopics).toEqual(['[2,"topic"]']);
  model.apply(
    [
      {
        id: 1,
        type: "user_topic",
        stream_id: 2,
        topic_name: "Topic",
        visibility_policy: 1,
      },
      {
        id: 2,
        type: "realm",
        op: "update_dict",
        property: "default",
        data: { can_resolve_topics_group: 7 },
      },
    ],
    1,
  );
  expect(model.state.followedTopics).toEqual([]);
  expect(model.state.organisation.realm_can_resolve_topics_group).toBe(7);
});
