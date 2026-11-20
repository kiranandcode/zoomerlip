import { afterEach, expect, it, vi } from "vitest";
import {
  channelDirectory,
  setChannelArchived,
} from "../src/organisation/channels";
import {
  canJoinChannel,
  canMembership,
  type Access,
} from "../src/organisation/permissions";
import { SessionModel } from "../src/sessionModel";
const account = {
  id: "archive",
  url: "https://fixture.invalid",
  email: "owner@fixture.invalid",
  apiKey: "synthetic",
  userId: 1,
  name: "Fixture",
};
const owner = {
  user_id: 1,
  full_name: "Owner",
  email: account.email,
  role: 100,
  is_active: true,
  is_bot: false,
};
const access: Access = {
  me: owner,
  groups: [],
  settings: {},
  featureLevel: 388,
};
const channel = {
  stream_id: 3,
  name: "Archive fixture",
  description: "",
  is_archived: false,
};
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
const mock = () => {
  const fetcher = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            result: "success",
            streams: [channel, { ...channel, stream_id: 4, is_archived: true }],
            subscriptions: [],
          }),
        ),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
it("gates archive by role and restore by server version and channel grants", async () => {
  const fetcher = mock();
  const member = { ...access, me: { ...owner, role: 400 } };
  await expect(
    setChannelArchived(account, member, channel, true, signal()),
  ).rejects.toThrow("cannot");
  await expect(
    setChannelArchived(
      account,
      { ...access, featureLevel: 387 },
      { ...channel, is_archived: true },
      false,
      signal(),
    ),
  ).rejects.toThrow("388");
  await expect(
    setChannelArchived(
      account,
      member,
      { ...channel, is_archived: true },
      false,
      signal(),
    ),
  ).rejects.toThrow("cannot");
  expect(fetcher).not.toHaveBeenCalled();
  await setChannelArchived(account, access, channel, true, signal());
  expect(fetcher.mock.calls[0][1].method).toBe("DELETE");
  await setChannelArchived(
    account,
    member,
    {
      ...channel,
      is_archived: true,
      can_administer_channel_group: {
        direct_members: [1],
        direct_subgroups: [],
      },
    },
    false,
    signal(),
  );
  expect(fetcher.mock.calls[1][1].method).toBe("PATCH");
  expect(fetcher.mock.calls[1][1].body.get("is_archived")).toBe("false");
});
it("uses versioned directory parameters without granting non-admin metadata access", async () => {
  const fetcher = mock();
  await expect(
    channelDirectory(account, signal(), { ...access, featureLevel: 314 }, true),
  ).rejects.toThrow("315");
  expect(fetcher).not.toHaveBeenCalled();
  const archived = await channelDirectory(account, signal(), access, true);
  expect(archived.channels.map((c) => c.stream_id)).toEqual([4]);
  let url = new URL(fetcher.mock.calls[0][0]);
  expect(url.searchParams.get("exclude_archived")).toBe("false");
  expect(url.searchParams.get("include_all")).toBe("true");
  await channelDirectory(
    account,
    signal(),
    { ...access, featureLevel: 315 },
    true,
  );
  url = new URL(fetcher.mock.calls[2][0]);
  expect(url.searchParams.get("include_all_active")).toBe("true");
  await channelDirectory(account, signal(), {
    ...access,
    me: { ...owner, role: 400 },
  });
  url = new URL(fetcher.mock.calls[4][0]);
  expect(url.searchParams.has("include_all")).toBe(false);
  expect(url.searchParams.get("exclude_archived")).toBe("true");
});
it("removes archived channels and unread state immediately, without inventing restored subscriptions", () => {
  const model = new SessionModel();
  model.register(
    {
      queue_id: "q",
      last_event_id: 0,
      subscriptions: [channel],
      unread_msgs: {
        streams: [{ stream_id: 3, topic: "T", unread_message_ids: [1] }],
      },
    },
    "Fixture",
  );
  expect(model.state.unread).toBe(1);
  model.apply(
    [
      {
        id: 1,
        type: "stream",
        op: "update",
        stream_id: 3,
        property: "is_archived",
        value: true,
      },
    ],
    1,
  );
  expect(model.state.channels).toEqual([]);
  expect(model.state.unread).toBe(0);
  model.apply(
    [
      {
        id: 2,
        type: "stream",
        op: "update",
        stream_id: 3,
        property: "is_archived",
        value: false,
      },
    ],
    1,
  );
  expect(model.state.channels).toEqual([]);
  model.register(
    {
      queue_id: "q2",
      last_event_id: 2,
      subscriptions: [{ ...channel, is_archived: true }],
    },
    "Fixture",
  );
  expect(model.state.channels).toEqual([]);
  expect(canJoinChannel(access, { ...channel, is_archived: true })).toBe(false);
  expect(
    canMembership(access, { ...channel, is_archived: true }, "remove", true),
  ).toBe(false);
});
