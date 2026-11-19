import type { Channel, User } from "../types";
export type GroupValue =
  number | { direct_members: number[]; direct_subgroups: number[] };
export type UserGroup = {
  id: number;
  name: string;
  description: string;
  members: number[];
  direct_subgroups?: number[];
  is_system_group?: boolean;
  deactivated?: boolean;
  can_manage_group?: GroupValue;
  can_add_members_group?: GroupValue;
  can_remove_members_group?: GroupValue;
};
export type OrganisationSettings = Record<string, unknown>;
export function organisationSettings(
  data: Record<string, unknown>,
): OrganisationSettings {
  return Object.fromEntries(
    Object.entries(data).filter(
      ([key]) =>
        key.startsWith("realm_can_") ||
        [
          "realm_edit_topic_policy",
          "realm_move_messages_between_streams_policy",
          "realm_move_messages_within_stream_limit_seconds",
          "realm_move_messages_between_streams_limit_seconds",
          "realm_allow_message_editing",
          "realm_user_group_edit_policy",
          "realm_name",
          "realm_description",
          "can_create_public_streams",
          "can_create_private_streams",
          "can_subscribe_other_users",
          "can_invite_others_to_realm",
          "max_topic_length",
          "max_stream_name_length",
          "max_stream_description_length",
          "zulip_feature_level",
        ].includes(key),
    ),
  );
}
export type Access = {
  me?: User;
  settings: OrganisationSettings;
  groups: UserGroup[];
  featureLevel: number;
};
export const isAdmin = (access: Access) =>
  !!access.me?.is_active && [100, 200].includes(access.me.role || 0);
export const isOwner = (access: Access) =>
  !!access.me?.is_active && access.me.role === 100;
export function inGroup(
  access: Access,
  value: unknown,
  visited = new Set<number>(),
): boolean {
  const me = access.me;
  if (!me?.is_active) return false;
  if (typeof value === "number") {
    if (visited.has(value) || visited.size > 1000) return false;
    visited.add(value);
    const group = access.groups.find((g) => g.id === value);
    if (!group || group.deactivated) return false;
    // System roles are evaluated against the current role, not stale members.
    if (group.is_system_group) {
      const role = me.role;
      switch (group.name) {
        case "role:everyone":
          return true;
        case "role:members":
          return !!role && role <= 400;
        case "role:administrators":
          return isAdmin(access);
        case "role:owners":
          return isOwner(access);
        case "role:moderators":
          return !!role && role <= 300;
        case "role:nobody":
          return false;
      }
    }
    return (
      group.members.includes(me.user_id) ||
      (group.direct_subgroups || []).some((id) => inGroup(access, id, visited))
    );
  }
  if (value && typeof value === "object") {
    const group = value as Partial<Exclude<GroupValue, number>>;
    return (
      !!group.direct_members?.includes(me.user_id) ||
      !!group.direct_subgroups?.some((id) => inGroup(access, id, visited))
    );
  }
  return false;
}
export function legacyPolicy(access: Access, policy: unknown) {
  const role = access.me?.role;
  if (!access.me?.is_active || !role) return false;
  return policy === 1
    ? role <= 400
    : policy === 2
      ? role <= 200
      : policy === 4
        ? role <= 300
        : policy === 5;
  // Full-member waiting-period policies require group membership information.
}
export function canAdminChannel(access: Access, channel: Channel) {
  return (
    isAdmin(access) ||
    (access.featureLevel >= 325 &&
      inGroup(access, channel.can_administer_channel_group))
  );
}
export function canTopic(
  access: Access,
  channel: Channel,
  action: "rename" | "move" | "resolve",
) {
  if (
    !access.me?.is_active ||
    (access.featureLevel < 159 &&
      access.settings.realm_allow_message_editing !== true)
  )
    return false;
  const move = action === "move";
  const group =
    action === "resolve" && access.featureLevel >= 367
      ? "realm_can_resolve_topics_group"
      : move
        ? "realm_can_move_messages_between_channels_group"
        : "realm_can_move_messages_between_topics_group";
  const modern =
    (action === "resolve" && access.featureLevel >= 367) ||
    access.featureLevel >= (move ? 310 : 316);
  return (
    (modern
      ? inGroup(access, access.settings[group])
      : legacyPolicy(
          access,
          access.settings[
            move
              ? "realm_move_messages_between_streams_policy"
              : "realm_edit_topic_policy"
          ],
        )) ||
    (action !== "resolve" &&
      access.featureLevel >= 396 &&
      (canAdminChannel(access, channel) ||
        inGroup(
          access,
          move
            ? channel.can_move_messages_out_of_channel_group
            : channel.can_move_messages_within_channel_group,
        ))) ||
    (action === "resolve" &&
      access.featureLevel >= 402 &&
      inGroup(access, channel.can_resolve_topics_group))
  );
}
export function canManageUser(access: Access, target: User) {
  return (
    isAdmin(access) &&
    access.me!.user_id !== target.user_id &&
    !target.is_bot &&
    (isOwner(access) || ![100, 200].includes(target.role || 0))
  );
}
export function canGroup(
  access: Access,
  group: UserGroup,
  action: "manage" | "add" | "remove",
) {
  if (group.is_system_group || group.deactivated) return false;
  if (access.featureLevel < 283)
    return legacyPolicy(access, access.settings.realm_user_group_edit_policy);
  return inGroup(
    access,
    action === "add" && access.featureLevel >= 305
      ? group.can_add_members_group
      : action === "remove" && access.featureLevel >= 324
        ? group.can_remove_members_group
        : group.can_manage_group,
  );
}
