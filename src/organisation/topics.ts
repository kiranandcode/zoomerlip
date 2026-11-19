import { request } from "../api";
import type { Account, Channel, Message } from "../types";
import { canTopic } from "./permissions";
import type { Access } from "./permissions";
export type Propagation = "change_one" | "change_later" | "change_all";
export async function setTopicPolicy(
  account: Account,
  channelId: number,
  topic: string,
  policy: 0 | 1 | 2 | 3,
  featureLevel: number,
  signal: AbortSignal,
) {
  if (featureLevel < 170 || (policy === 3 && featureLevel < 219))
    throw new Error("This server does not support this topic preference.");
  return request(
    account,
    "/user_topics",
    { stream_id: channelId, topic, visibility_policy: policy },
    "POST",
    signal,
  );
}
export async function topicAnchor(
  account: Account,
  channelId: number,
  topic: string,
  signal: AbortSignal,
) {
  const data = await request<{ messages: Message[] }>(
    account,
    "/messages",
    {
      narrow: [
        { operator: "stream", operand: channelId },
        { operator: "topic", operand: topic },
      ],
      anchor: "newest",
      num_before: 1,
      num_after: 0,
      apply_markdown: true,
    },
    "GET",
    signal,
  );
  const message = data.messages.at(-1);
  if (!message) throw new Error("This topic has no accessible messages.");
  return message;
}
export async function moveTopic(
  account: Account,
  access: Access,
  channel: Channel,
  message: Message,
  destination: number,
  topic: string,
  propagation: Propagation,
  notify: boolean,
  signal: AbortSignal,
) {
  const resolving =
    destination === channel.stream_id &&
    propagation === "change_all" &&
    (topic === `✔ ${message.subject}` || message.subject === `✔ ${topic}`);
  if (
    !canTopic(
      access,
      channel,
      destination !== channel.stream_id
        ? "move"
        : resolving
          ? "resolve"
          : "rename",
    )
  )
    throw new Error("Your permissions do not allow this topic change.");
  if (
    !topic.trim() ||
    topic.length > Number(access.settings.max_topic_length || 60)
  )
    throw new Error("Enter a topic within the server's length limit.");
  if (message.type !== "stream" || message.stream_id !== channel.stream_id)
    throw new Error("The selected message has moved. Refresh the topic.");
  const limit =
    access.settings[
      destination === channel.stream_id
        ? "realm_move_messages_within_stream_limit_seconds"
        : "realm_move_messages_between_streams_limit_seconds"
    ];
  if (
    typeof limit === "number" &&
    limit >= 0 &&
    (access.me?.role || 600) > 300 &&
    Date.now() / 1000 - message.timestamp > limit
  )
    throw new Error(
      "The organization's time limit for moving this message has passed.",
    );
  return request(
    account,
    `/messages/${message.id}`,
    {
      topic,
      propagate_mode: propagation,
      ...(destination !== channel.stream_id ? { stream_id: destination } : {}),
      send_notification_to_old_thread: notify,
      send_notification_to_new_thread: notify,
    },
    "PATCH",
    signal,
  );
}
