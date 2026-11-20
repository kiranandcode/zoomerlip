import { request } from "../api";
import type { Account, Channel } from "../types";
import {
  canAdminChannel,
  canCreateChannel,
  canJoinChannel,
  canMembership,
  isAdmin,
} from "./permissions";
import type { Access } from "./permissions";
export async function mutation(
  account: Account,
  path: string,
  params: Record<string, unknown>,
  method: string,
  signal: AbortSignal,
) {
  const result = await request<{ ignored_parameters_unsupported?: string[] }>(
    account,
    path,
    params,
    method,
    signal,
  );
  if (result.ignored_parameters_unsupported?.length)
    throw new Error(
      `Some changes may have saved. This server ignored: ${result.ignored_parameters_unsupported.join(", ")}. Refresh before retrying.`,
    );
  return result;
}
export async function channelDirectory(
  account: Account,
  signal: AbortSignal,
  access?: Access,
  archived = false,
) {
  if (archived && (!access || access.featureLevel < 315))
    throw new Error(
      "Archived channels require Zulip feature level 315 or later.",
    );
  const [directory, subscriptions] = await Promise.all([
    request<{ streams: Channel[] }>(
      account,
      "/streams",
      {
        include_public: true,
        include_subscribed: true,
        ...(access && isAdmin(access)
          ? access.featureLevel >= 356
            ? { include_all: true }
            : { include_all_active: true }
          : {}),
        ...(access && access.featureLevel >= 315
          ? { exclude_archived: !archived }
          : {}),
      },
      "GET",
      signal,
    ),
    request<{ subscriptions: Channel[] }>(
      account,
      "/users/me/subscriptions",
      {},
      "GET",
      signal,
    ),
  ]);
  if (
    directory.streams.length > 10000 ||
    subscriptions.subscriptions.length > 10000
  )
    throw new Error(
      "The channel directory exceeds this client's 10,000-channel limit.",
    );
  const personal = new Map(
    subscriptions.subscriptions.map((c) => [c.stream_id, c]),
  );
  return {
    channels: directory.streams
      .filter((c) => !!c.is_archived === archived)
      .map((c) => {
        const subscription = personal.get(c.stream_id);
        return subscription ? { ...c, is_muted: subscription.is_muted } : c;
      }),
    subscribed: new Set(subscriptions.subscriptions.map((c) => c.stream_id)),
  };
}
export async function setChannelArchived(
  account: Account,
  access: Access,
  channel: Channel,
  archived: boolean,
  signal: AbortSignal,
) {
  // DELETE is administrator-only in the documented archive API.
  if (archived ? !isAdmin(access) : !canAdminChannel(access, channel))
    throw new Error("You cannot change this channel's archive state.");
  if (!archived && access.featureLevel < 388)
    throw new Error(
      "Restoring channels requires Zulip feature level 388 or later.",
    );
  if (!!channel.is_archived === archived)
    throw new Error("Refresh the channel's archive state before retrying.");
  return mutation(
    account,
    `/streams/${channel.stream_id}`,
    archived ? {} : { is_archived: false },
    archived ? "DELETE" : "PATCH",
    signal,
  );
}
export async function createChannel(
  account: Account,
  access: Access,
  name: string,
  description: string,
  privateChannel: boolean,
  signal: AbortSignal,
) {
  if (!canCreateChannel(access, privateChannel))
    throw new Error("You cannot create this type of channel.");
  if (
    !name.trim() ||
    name.length > Number(access.settings.max_stream_name_length || 60)
  )
    throw new Error("Enter a channel name within the server limit.");
  const common = {
    invite_only: privateChannel,
    history_public_to_subscribers: true,
    announce: false,
  };
  if (access.featureLevel >= 417)
    return mutation(
      account,
      "/channels/create",
      {
        ...common,
        name: name.trim(),
        description,
        subscribers: [account.userId],
      },
      "POST",
      signal,
    );
  return mutation(
    account,
    "/users/me/subscriptions",
    { ...common, subscriptions: [{ name: name.trim(), description }] },
    "POST",
    signal,
  );
}
export async function changeSubscription(
  account: Account,
  access: Access,
  channel: Channel,
  join: boolean,
  subscribed: boolean,
  signal: AbortSignal,
  userId?: number,
) {
  if (
    userId !== undefined
      ? !canMembership(access, channel, join ? "add" : "remove", subscribed)
      : join && !canJoinChannel(access, channel)
  )
    throw new Error("You cannot change this membership.");
  // Resolve the current name by ID immediately before the name-based API.
  const current =
    access.featureLevel >= 132
      ? (
          await request<{ stream: Channel }>(
            account,
            `/streams/${channel.stream_id}`,
            {},
            "GET",
            signal,
          )
        ).stream
      : channel;
  return mutation(
    account,
    "/users/me/subscriptions",
    {
      subscriptions: join ? [{ name: current.name }] : [current.name],
      ...(userId !== undefined ? { principals: [userId] } : {}),
      ...(join ? { authorization_errors_fatal: true } : {}),
      ...(!join && access.featureLevel >= 515
        ? { send_messages_to_removed_subscribers: false }
        : {}),
    },
    join ? "POST" : "DELETE",
    signal,
  );
}
export async function updateChannel(
  account: Account,
  access: Access,
  channel: Channel,
  values: { name: string; description: string; privateChannel: boolean },
  subscribed: boolean,
  signal: AbortSignal,
) {
  if (!canAdminChannel(access, channel))
    throw new Error("You cannot administer this channel.");
  const params: Record<string, unknown> = {};
  if (values.name !== channel.name) params.new_name = values.name;
  if (values.description !== channel.description)
    params.description = values.description;
  if (values.privateChannel !== !!channel.invite_only) {
    if (
      !subscribed ||
      channel.is_web_public ||
      !canCreateChannel(access, values.privateChannel)
    )
      throw new Error("You cannot change this channel's privacy.");
    params.is_private = values.privateChannel;
    // Preserve shared history; public channels require it.
    params.history_public_to_subscribers = values.privateChannel
      ? channel.history_public_to_subscribers !== false
      : true;
  }
  if (!Object.keys(params).length) return;
  return mutation(
    account,
    `/streams/${channel.stream_id}`,
    params,
    "PATCH",
    signal,
  );
}
