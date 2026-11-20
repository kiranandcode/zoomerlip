import { expect, it } from "vitest";
import { SessionModel, topicKey } from "../src/sessionModel";
import {
  navigationUnreads,
  prioritizeUnreadTopics,
} from "../src/unreadNavigation";
import { emptySearch, searchNarrow } from "../src/organisation/search";

it("rolls up collapsed channel counts with the same mute rules as the org badge", () => {
  const model = new SessionModel();
  model.register(
    {
      queue_id: "q",
      last_event_id: 0,
      subscriptions: [
        { stream_id: 1, name: "general", description: "" },
        { stream_id: 2, name: "muted", description: "", is_muted: true },
      ],
      user_topics: [
        { stream_id: 1, topic_name: "quiet", visibility_policy: 1 },
        { stream_id: 2, topic_name: "exception", visibility_policy: 2 },
      ],
      unread_msgs: {
        streams: [
          { stream_id: 1, topic: "old", unread_message_ids: [1, 2] },
          { stream_id: 1, topic: "quiet", unread_message_ids: [3] },
          { stream_id: 1, topic: "snoozed", unread_message_ids: [4] },
          { stream_id: 2, topic: "quiet", unread_message_ids: [5] },
          { stream_id: 2, topic: "exception", unread_message_ids: [6] },
        ],
        pms: [{ other_user_id: 7, unread_message_ids: [7] }],
      },
    },
    "Org",
  );
  const local = { [topicKey(1, "snoozed")]: { until: null } };
  expect(navigationUnreads(model.state, local)).toMatchObject({
    channels: { 1: 2, 2: 1 },
    total: 4,
  });
  model.apply(
    [
      {
        id: 1,
        type: "update_message_flags",
        op: "add",
        flag: "read",
        messages: [1, 2],
      },
    ],
    1,
  );
  expect(navigationUnreads(model.state, local)).toMatchObject({
    channels: { 2: 1 },
    total: 2,
  });
  expect(navigationUnreads(model.state, {}).total).toBe(3);
  expect(searchNarrow({ ...emptySearch, special: "unread" })).toEqual([
    { operator: "is", operand: "unread" },
  ]);
});

it("surfaces old or unfetched unread topics without duplicating differently cased names", () => {
  const recent = Array.from({ length: 30 }, (_, i) => ({
    name: `Read ${i}`,
    max_id: 100 - i,
  }));
  const loaded = [...recent, { name: "Old Topic", max_id: 1 }];
  const unreads = [
    { name: "old topic", max_id: 0 },
    { name: "not fetched", max_id: 0 },
  ];
  const sorted = prioritizeUnreadTopics(1, loaded, unreads);
  expect(sorted.slice(0, 2).map((t) => t.name)).toEqual([
    "Old Topic",
    "not fetched",
  ]);
  expect(sorted).toHaveLength(32);
  expect(loaded[0].name).toBe("Read 0");
  expect(prioritizeUnreadTopics(1, undefined, unreads)).toEqual(unreads);
});
