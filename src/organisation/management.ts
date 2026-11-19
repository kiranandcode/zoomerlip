import { request } from "../api";
import type { Account, User } from "../types";
import type { Access, UserGroup } from "./permissions";
import {
  canGroup,
  canInvite,
  canManageUser,
  inGroup,
  isAdmin,
  isOwner,
  legacyPolicy,
} from "./permissions";
import { mutation } from "./channels";
export const roleNames: Record<number, string> = {
  100: "Owner",
  200: "Administrator",
  300: "Moderator",
  400: "Member",
  600: "Guest",
};
export const defaultSettings = {
  enable_stream_desktop_notifications:
    "Desktop notifications for channel messages",
  enable_stream_push_notifications: "Mobile notifications for channel messages",
  enable_offline_email_notifications: "Email notifications when offline",
} as const;
export type Invite = {
  id: number;
  email?: string;
  is_multiuse: boolean;
  invited_as: number;
  invited_by_user_id: number;
  expiry_date: number | null;
};
export async function sendInvitations(
  account: Account,
  access: Access,
  emails: string,
  role: number,
  signal: AbortSignal,
) {
  if (!canInvite(access) || role < (access.me?.role || 600) || !roleNames[role])
    throw new Error("You cannot send this invitation.");
  if (access.featureLevel < 180)
    throw new Error(
      "Invitations without channel selection require feature level 180.",
    );
  if (
    !emails.trim() ||
    emails.length > 10000 ||
    emails.split(/[,\n]/).filter(Boolean).length > 50
  )
    throw new Error("Enter between 1 and 50 email addresses.");
  return mutation(
    account,
    "/invites",
    {
      invitee_emails: emails,
      invite_as: role,
      stream_ids: [],
      invite_expires_in_minutes: 7 * 24 * 60,
      ...(access.featureLevel >= 261
        ? { include_realm_default_subscriptions: true }
        : {}),
      ...(access.featureLevel >= 267 ? { notify_referrer_on_join: false } : {}),
    },
    "POST",
    signal,
  );
}
export async function revokeInvitation(
  account: Account,
  access: Access,
  invite: Invite,
  signal: AbortSignal,
) {
  if (!isAdmin(access) && invite.invited_by_user_id !== account.userId)
    throw new Error("You cannot revoke this invitation.");
  return mutation(
    account,
    `/invites/${invite.is_multiuse ? "multiuse/" : ""}${invite.id}`,
    {},
    "DELETE",
    signal,
  );
}
export async function updateMember(
  account: Account,
  access: Access,
  target: User,
  values: { name: string; role: number },
  signal: AbortSignal,
) {
  if (
    !canManageUser(access, target) ||
    !roleNames[values.role] ||
    (values.role === 100 && !isOwner(access))
  )
    throw new Error("You cannot change this member.");
  const params: Record<string, unknown> = {};
  if (values.name !== target.full_name)
    params.full_name =
      access.featureLevel >= 106 ? values.name : JSON.stringify(values.name);
  if (values.role !== target.role) params.role = values.role;
  if (!Object.keys(params).length) return;
  return mutation(account, `/users/${target.user_id}`, params, "PATCH", signal);
}
export async function setMemberActive(
  account: Account,
  access: Access,
  target: User,
  active: boolean,
  signal: AbortSignal,
) {
  if (!canManageUser(access, target))
    throw new Error("You cannot change this member.");
  return mutation(
    account,
    `/users/${target.user_id}${active ? "/reactivate" : ""}`,
    {},
    active ? "POST" : "DELETE",
    signal,
  );
}
export const canCreateGroup = (access: Access) =>
  access.featureLevel >= 299
    ? inGroup(access, access.settings.realm_can_create_groups)
    : legacyPolicy(access, access.settings.realm_user_group_edit_policy);
export function memberIds(text: string, users: User[]) {
  if (!text.trim()) return [];
  const ids = [...new Set(text.split(/[\s,]+/).map(Number))];
  if (
    ids.length > 100 ||
    ids.some(
      (id) =>
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !users.some((u) => u.user_id === id && u.is_active),
    )
  )
    throw new Error("Enter up to 100 active member IDs, separated by commas.");
  return ids;
}
export async function createGroup(
  account: Account,
  access: Access,
  name: string,
  description: string,
  members: number[],
  signal: AbortSignal,
) {
  if (!canCreateGroup(access))
    throw new Error("You cannot create user groups.");
  return mutation(
    account,
    "/user_groups/create",
    { name, description, members },
    "POST",
    signal,
  );
}
export async function updateGroup(
  account: Account,
  access: Access,
  group: UserGroup,
  values: { name: string; description: string },
  signal: AbortSignal,
) {
  if (!canGroup(access, group, "manage"))
    throw new Error("You cannot manage this group.");
  return mutation(account, `/user_groups/${group.id}`, values, "PATCH", signal);
}
export async function groupMembers(
  account: Account,
  access: Access,
  group: UserGroup,
  ids: number[],
  add: boolean,
  signal: AbortSignal,
) {
  if (!canGroup(access, group, add ? "add" : "remove"))
    throw new Error("You cannot change these group memberships.");
  return mutation(
    account,
    `/user_groups/${group.id}/members`,
    { [add ? "add" : "delete"]: ids },
    "POST",
    signal,
  );
}
export async function deactivateGroup(
  account: Account,
  access: Access,
  group: UserGroup,
  signal: AbortSignal,
) {
  if (!canGroup(access, group, "manage") || access.featureLevel < 290)
    throw new Error("Group deactivation is unavailable.");
  return mutation(
    account,
    `/user_groups/${group.id}/deactivate`,
    {},
    "POST",
    signal,
  );
}
export async function updateDefaults(
  account: Account,
  access: Access,
  values: Record<string, boolean>,
  signal: AbortSignal,
) {
  if (!isAdmin(access) || access.featureLevel < 96)
    throw new Error("You cannot edit organisation defaults.");
  if (Object.keys(values).some((key) => !(key in defaultSettings)))
    throw new Error("Unsupported default setting.");
  return mutation(
    account,
    "/realm/user_settings_defaults",
    values,
    "PATCH",
    signal,
  );
}
export async function listMembers(account: Account, signal: AbortSignal) {
  const data = await request<{ members: User[] }>(
    account,
    "/users",
    { client_gravatar: false },
    "GET",
    signal,
  );
  if (data.members.length > 50000)
    throw new Error(
      "The member directory exceeds this client's 50,000-member limit.",
    );
  return data.members;
}
