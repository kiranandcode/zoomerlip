import { afterEach, expect, it, vi } from "vitest";
import {
  applyPreferencePlan,
  preparePreferencePlan,
  setChannelMuted,
} from "../src/organisation/subscriptionPreferences";
const account = {
  id: "prefs",
  url: "https://preferences.invalid",
  email: "test@preferences.invalid",
  apiKey: "synthetic",
  userId: 1,
  name: "Fixture",
};
const channel = (id: number, muted = false) => ({
  stream_id: id,
  name: `Channel ${id}`,
  is_muted: muted,
});
const topic = (id: number, name: string, policy = 3) => ({
  stream_id: id,
  topic_name: name,
  visibility_policy: policy,
});
const signal = () => new AbortController().signal;
type Call = { path: string; method: string; body: URLSearchParams };
function fixture(
  initialChannels = [channel(1), channel(2)],
  initialTopics = [topic(1, "Followed"), topic(2, "Muted", 1)],
) {
  const state = { channels: initialChannels, topics: initialTopics };
  const calls: Call[] = [];
  let respond: ((call: Call) => Response | undefined) | undefined;
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    const call = {
      path: new URL(url).pathname.replace("/api/v1", ""),
      method: options.method!,
      body: options.body as URLSearchParams,
    };
    calls.push(call);
    const override = respond?.(call);
    if (override) return override;
    if (call.path === "/users/me/subscriptions")
      return new Response(JSON.stringify({ subscriptions: state.channels }));
    if (call.path === "/register")
      return new Response(
        JSON.stringify({ queue_id: "temporary", user_topics: state.topics }),
      );
    return new Response('{"result":"success"}');
  });
  vi.stubGlobal("fetch", fetcher);
  return {
    state,
    calls,
    intercept(fn: typeof respond) {
      respond = fn;
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
it("gates actions before requests and requires current subscription for single mute/unmute", async () => {
  const f = fixture();
  await expect(
    setChannelMuted(account, 138, 1, true, signal()),
  ).rejects.toThrow("139");
  await expect(
    preparePreferencePlan(account, 218, "unfollow", signal()),
  ).rejects.toThrow("219");
  expect(f.calls).toEqual([]);
  await setChannelMuted(account, 139, 1, true, signal());
  expect(JSON.parse(f.calls.at(-1)!.body.get("subscription_data")!)).toEqual([
    { stream_id: 1, property: "is_muted", value: true },
  ]);
  f.state.channels = [channel(1, true)];
  await setChannelMuted(account, 139, 1, false, signal());
  expect(
    JSON.parse(f.calls.at(-1)!.body.get("subscription_data")!)[0].value,
  ).toBe(false);
  await expect(
    setChannelMuted(account, 139, 2, true, signal()),
  ).rejects.toThrow("no longer subscribed");
  expect(f.calls.filter((c) => c.method === "DELETE")).toEqual([]);
});
it("revalidates bulk mute, preserves unconfirmed new subscriptions and reports partial rejection", async () => {
  const f = fixture([channel(1), channel(2), channel(3), channel(4, true)]);
  const plan = await preparePreferencePlan(account, 400, "mute", signal());
  expect(plan.targets.map((t) => t.streamId)).toEqual([1, 2, 3]);
  f.state.channels = [channel(1), channel(2), channel(3, true), channel(5)];
  f.intercept((c) =>
    c.path.endsWith("/properties") &&
    JSON.parse(c.body.get("subscription_data")!)[0].stream_id === 2
      ? new Response('{"msg":"Subscription removed","result":"error"}', {
          status: 403,
        })
      : undefined,
  );
  const report = await applyPreferencePlan(account, 400, plan, signal());
  expect(report).toMatchObject({
    total: 3,
    succeeded: 1,
    skipped: 1,
    unattempted: 0,
    stopped: false,
  });
  expect(report.failures).toEqual([
    { label: "Channel 2", error: "Subscription removed" },
  ]);
  const writes = f.calls.filter((c) => c.path.endsWith("/properties"));
  expect(
    writes.map(
      (c) => JSON.parse(c.body.get("subscription_data")!)[0].stream_id,
    ),
  ).toEqual([1, 2]);
});
it("unfollows only still-followed confirmed topics and releases temporary queues", async () => {
  const f = fixture(
    [],
    [
      topic(1, "Followed Case"),
      topic(2, "Changed"),
      topic(3, "Muted", 1),
      topic(4, "Unmuted", 2),
    ],
  );
  const plan = await preparePreferencePlan(account, 400, "unfollow", signal());
  expect(plan.targets.map((t) => t.topic)).toEqual([
    "Followed Case",
    "Changed",
  ]);
  f.state.topics = [
    topic(1, "Followed Case"),
    topic(2, "Changed", 1),
    topic(3, "Muted", 1),
    topic(4, "Unmuted", 2),
    topic(5, "New Follow"),
  ];
  const report = await applyPreferencePlan(account, 400, plan, signal());
  expect(report).toMatchObject({ succeeded: 1, skipped: 1, failures: [] });
  const writes = f.calls.filter((c) => c.path === "/user_topics");
  expect(writes.map((c) => Object.fromEntries(c.body))).toEqual([
    { stream_id: "1", topic: "Followed Case", visibility_policy: "0" },
  ]);
  expect(
    f.calls.filter((c) => c.path === "/events" && c.method === "DELETE"),
  ).toHaveLength(2);
  expect(
    f.calls
      .filter((c) => c.path === "/register")
      .every((c) => c.body.get("event_types") === "[]"),
  ).toBe(true);
  for (const call of f.calls.filter((c) => c.path === "/register"))
    expect(JSON.parse(call.body.get("client_capabilities")!)).toMatchObject({
      notification_settings_null: true,
    });
});
it("stops after ambiguous response or cancellation without replaying earlier writes", async () => {
  const f = fixture([channel(1), channel(2), channel(3)]);
  const plan = await preparePreferencePlan(account, 400, "mute", signal());
  f.intercept((c) =>
    c.path.endsWith("/properties") &&
    JSON.parse(c.body.get("subscription_data")!)[0].stream_id === 2
      ? new Response('{"ignored_parameters_unsupported":["is_muted"]}')
      : undefined,
  );
  const report = await applyPreferencePlan(account, 400, plan, signal());
  expect(report).toMatchObject({ succeeded: 1, unattempted: 1, stopped: true });
  expect(report.failures[0].error).toContain("Outcome not confirmed");
  f.intercept(undefined);
  const controller = new AbortController();
  const cancelled = await applyPreferencePlan(
    account,
    400,
    plan,
    controller.signal,
    (progress) => {
      if (progress.succeeded) controller.abort();
    },
  );
  expect(cancelled).toMatchObject({
    succeeded: 1,
    unattempted: 2,
    stopped: true,
  });
});
it("rejects cross-account plans, incomplete snapshots and oversized snapshots before preference writes", async () => {
  const f = fixture();
  const plan = await preparePreferencePlan(account, 400, "mute", signal());
  const count = f.calls.length;
  await expect(
    applyPreferencePlan({ ...account, id: "other" }, 400, plan, signal()),
  ).rejects.toThrow("another account");
  expect(f.calls).toHaveLength(count);
  f.intercept((c) =>
    c.path === "/register"
      ? new Response('{"queue_id":"temporary"}')
      : undefined,
  );
  await expect(
    preparePreferencePlan(account, 400, "unfollow", signal()),
  ).rejects.toThrow("complete topic");
  expect(f.calls.at(-1)?.path).toBe("/events");
  f.intercept(undefined);
  f.state.channels = Array.from({ length: 10001 }, (_, i) => channel(i + 1));
  await expect(
    preparePreferencePlan(account, 400, "mute", signal()),
  ).rejects.toThrow("10,000");
  expect(f.calls.some((c) => c.path.endsWith("/properties"))).toBe(false);
});
