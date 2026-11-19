import { afterEach, expect, it, vi } from "vitest";
import {
  canCreateChannel,
  canJoinChannel,
  canManageUser,
  canGroup,
} from "../src/organisation/permissions";
import type { Access } from "../src/organisation/permissions";
import {
  createChannel,
  changeSubscription,
  updateChannel,
  mutation,
} from "../src/organisation/channels";
import {
  groupMembers,
  memberIds,
  sendInvitations,
  updateDefaults,
  updateMember,
  setMemberActive,
} from "../src/organisation/management";
import { SessionModel } from "../src/sessionModel";
const account = {
  id: "test",
  url: "https://fixture.invalid",
  email: "a@fixture.invalid",
  apiKey: "test",
  userId: 1,
  name: "Fixture",
};
const owner = {
  user_id: 1,
  full_name: "Owner",
  email: "a",
  role: 100,
  is_active: true,
  is_bot: false,
};
const member = { ...owner, user_id: 2, full_name: "Member", role: 400 };
const access: Access = {
  me: owner,
  featureLevel: 417,
  groups: [],
  settings: {
    can_create_public_streams: true,
    can_create_private_streams: false,
    can_invite_others_to_realm: true,
  },
};
const channel = {
  stream_id: 2,
  name: "Test",
  description: "",
  invite_only: false,
};
afterEach(() => vi.unstubAllGlobals());
const mock = () => {
  const fetcher = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response('{"result":"success"}')),
    );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
it("creates only permitted channel types with the versioned endpoint", async () => {
  const fetcher = mock();
  expect(canCreateChannel(access, true)).toBe(false);
  await expect(
    createChannel(
      account,
      access,
      "Private",
      "",
      true,
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await createChannel(
    account,
    access,
    "Public",
    "A",
    false,
    new AbortController().signal,
  );
  expect(fetcher.mock.calls[0][0]).toBe(
    `${account.url}/api/v1/channels/create`,
  );
  expect(fetcher.mock.calls[0][1].body.get("subscribers")).toBe("[1]");
  await createChannel(
    account,
    { ...access, featureLevel: 416 },
    "Public",
    "A",
    false,
    new AbortController().signal,
  );
  expect(fetcher.mock.calls[1][0]).toContain("/users/me/subscriptions");
});
it("allows public joins for members and denies unknown private grants", () => {
  expect(canJoinChannel({ ...access, me: member }, channel)).toBe(true);
  expect(
    canJoinChannel({ ...access, me: { ...member, role: 600 } }, channel),
  ).toBe(false);
  expect(canJoinChannel(access, { ...channel, invite_only: true })).toBe(false);
});
it("refreshes channel name before membership mutations and sends no notification on new servers", async () => {
  const fetcher = mock();
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ stream: { ...channel, name: "Current" } })),
  );
  await changeSubscription(
    account,
    { ...access, featureLevel: 515 },
    channel,
    false,
    true,
    new AbortController().signal,
    2,
  );
  expect(fetcher.mock.calls[0][0]).toContain("/streams/2");
  expect(fetcher.mock.calls[1][1].body.get("subscriptions")).toBe(
    '["Current"]',
  );
  expect(fetcher.mock.calls[1][1].body.get("principals")).toBe("[2]");
  expect(
    fetcher.mock.calls[1][1].body.get("send_messages_to_removed_subscribers"),
  ).toBe("false");
});
it("does not send unchanged settings or unauthorized privacy transitions", async () => {
  const fetcher = mock();
  await updateChannel(
    account,
    access,
    channel,
    { name: "Test", description: "", privateChannel: false },
    true,
    new AbortController().signal,
  );
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    updateChannel(
      account,
      access,
      channel,
      { name: "Test", description: "", privateChannel: true },
      true,
      new AbortController().signal,
    ),
  ).rejects.toThrow("privacy");
  expect(fetcher).not.toHaveBeenCalled();
});
it("protects owners, self changes and role promotions", async () => {
  const fetcher = mock();
  const admin = { ...access, me: { ...owner, role: 200 } };
  expect(canManageUser(admin, { ...owner, user_id: 3 })).toBe(false);
  expect(canManageUser(access, owner)).toBe(false);
  await expect(
    updateMember(
      account,
      admin,
      member,
      { name: "Member", role: 100 },
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await updateMember(
    account,
    access,
    member,
    { name: "Member", role: 200 },
    new AbortController().signal,
  );
  expect(fetcher.mock.calls[0][1].body.get("role")).toBe("200");
  await setMemberActive(
    account,
    access,
    member,
    false,
    new AbortController().signal,
  );
  expect(fetcher.mock.calls[1][1].method).toBe("DELETE");
  expect(fetcher.mock.calls[1][1].body.has("actions")).toBe(false);
});
it("gates invitation roles and explicitly sets expiry and subscriptions", async () => {
  const fetcher = mock();
  await expect(
    sendInvitations(
      account,
      { ...access, me: member },
      "new@fixture.invalid",
      200,
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await sendInvitations(
    account,
    access,
    "new@fixture.invalid",
    400,
    new AbortController().signal,
  );
  expect(fetcher.mock.calls[0][1].body.get("invite_expires_in_minutes")).toBe(
    "10080",
  );
  expect(fetcher.mock.calls[0][1].body.get("stream_ids")).toBe("[]");
});
it("honors separate group membership permissions and prevents system-group edits", async () => {
  const fetcher = mock();
  const group = {
    id: 4,
    name: "G",
    description: "",
    members: [],
    can_add_members_group: { direct_members: [1], direct_subgroups: [] },
  };
  expect(canGroup(access, group, "add")).toBe(true);
  expect(canGroup(access, group, "remove")).toBe(false);
  expect(canGroup(access, { ...group, is_system_group: true }, "add")).toBe(
    false,
  );
  await groupMembers(
    account,
    access,
    group,
    [2],
    true,
    new AbortController().signal,
  );
  expect(fetcher.mock.calls[0][1].body.get("add")).toBe("[2]");
  expect(memberIds("2, 2", [member])).toEqual([2]);
  expect(() => memberIds("-1", [member])).toThrow();
});
it("limits editable defaults and reports unsupported parameters as partial saves", async () => {
  const fetcher = mock();
  await expect(
    updateDefaults(
      account,
      access,
      { unknown: true },
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(
    new Response('{"result":"success","ignored_parameters_unsupported":["x"]}'),
  );
  await expect(
    mutation(
      account,
      "/realm/user_settings_defaults",
      { x: true },
      "PATCH",
      new AbortController().signal,
    ),
  ).rejects.toThrow("Some changes may have saved");
});
it("applies documented new-user default events", () => {
  const model = new SessionModel();
  model.register(
    {
      queue_id: "q",
      last_event_id: 0,
      realm_user_settings_defaults: { enable_stream_push_notifications: false },
    },
    "Fixture",
  );
  model.apply(
    [
      {
        id: 1,
        type: "realm_user_settings_defaults",
        op: "update",
        property: "enable_stream_push_notifications",
        value: true,
      },
    ],
    1,
  );
  expect(model.state.organisation.realm_user_settings_defaults).toEqual({
    enable_stream_push_notifications: true,
  });
});
