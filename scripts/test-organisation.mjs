// Every API operation is intercepted. Never send fixture writes to a real org.
import { chromium, expect } from "@playwright/test";
const url = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4182";
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Local fixture only.");
const account = {
  id: "https://fixture.zulip.test|1",
  url: "https://fixture.zulip.test",
  email: "owner@fixture.invalid",
  apiKey: "synthetic",
  name: "Fixture",
  userId: 1,
};
const second = {
  ...account,
  id: "https://other.zulip.test|1",
  url: "https://other.zulip.test",
  name: "Other",
};
const grant = { direct_members: [1], direct_subgroups: [] };
const users = [
  {
    user_id: 1,
    full_name: "Fixture Owner",
    email: account.email,
    role: 100,
    is_active: true,
    is_bot: false,
  },
  {
    user_id: 2,
    full_name: "Fixture Member",
    email: "member@fixture.invalid",
    role: 400,
    is_active: true,
    is_bot: false,
  },
];
const channels = [
  {
    stream_id: 1,
    name: "private-room",
    description: "Private fixture",
    invite_only: true,
    history_public_to_subscribers: true,
    can_administer_channel_group: grant,
    can_subscribe_group: grant,
  },
  {
    stream_id: 2,
    name: "public-room",
    description: "Public fixture",
    invite_only: false,
    history_public_to_subscribers: true,
  },
];
let subscriptions = [1],
  muted = false,
  followed = false,
  topic = "Thread",
  groups = [
    {
      id: 7,
      name: "Editors",
      description: "Fixture group",
      members: [1],
      is_system_group: false,
      can_manage_group: grant,
      can_add_members_group: grant,
      can_remove_members_group: grant,
    },
  ];
const defaults = {
  enable_stream_desktop_notifications: false,
  enable_stream_push_notifications: false,
  enable_offline_email_notifications: true,
};
const writes = [],
  errors = [],
  blocked = [],
  events = [];
let pending,
  eventId = 0,
  failChannel = false;
const message = (id, subject = topic, stream = 1) => ({
  id,
  sender_id: 2,
  sender_full_name: "Fixture Member",
  avatar_url: null,
  timestamp: 1700000000 + id,
  content: `<p>Message ${id}</p>`,
  type: "stream",
  stream_id: stream,
  subject,
  display_recipient: stream === 1 ? "private-room" : "public-room",
  reactions: [],
  flags: [],
});
const headers = { "access-control-allow-origin": "*" };
const reply = (route, data) =>
  route
    .fulfill({ json: { result: "success", msg: "", ...data }, headers })
    .catch(() => {});
async function emit(event) {
  events.push({ ...event, id: ++eventId });
  if (pending) {
    const r = pending;
    pending = undefined;
    await reply(r, { events: events.splice(0) });
  }
}
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disable-gpu"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
context.setDefaultTimeout(10000);
await context.addInitScript(
  (accounts) =>
    localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify(accounts)),
  [account, second],
);
await context.route("**/*", (route) => {
  if (new URL(route.request().url()).origin === new URL(url).origin)
    return route.continue();
  blocked.push(route.request().url());
  return route.abort();
});
await context.route(
  /^https:\/\/(fixture|other)\.zulip\.test\//,
  async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      path = u.pathname.replace("/api/v1", ""),
      body = new URLSearchParams(req.postData() || "");
    if (req.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          ...headers,
          "access-control-allow-headers": "authorization,content-type",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE",
        },
      });
    if (
      !["GET", "OPTIONS"].includes(req.method()) &&
      !["/register", "/events"].includes(path)
    )
      writes.push({
        path,
        method: req.method(),
        body: Object.fromEntries(body),
      });
    if (path === "/register")
      return reply(route, {
        queue_id: u.hostname,
        last_event_id: eventId,
        zulip_feature_level: 417,
        realm_name: u.hostname.startsWith("other") ? "Other" : "Fixture",
        realm_users: users,
        subscriptions: channels.filter((c) =>
          subscriptions.includes(c.stream_id),
        ),
        user_topics: [
          {
            stream_id: 1,
            topic_name: topic,
            visibility_policy: followed ? 3 : muted ? 1 : 0,
          },
        ],
        can_create_public_streams: true,
        can_create_private_streams: true,
        can_subscribe_other_users: true,
        can_invite_others_to_realm: true,
        realm_can_move_messages_between_topics_group: grant,
        realm_can_move_messages_between_channels_group: grant,
        realm_can_resolve_topics_group: grant,
        realm_can_create_groups: grant,
        realm_user_settings_defaults: defaults,
        max_topic_length: 60,
      });
    if (path === "/events") {
      if (req.method() === "DELETE") return reply(route, {});
      if (events.length) return reply(route, { events: events.splice(0) });
      if (u.hostname.startsWith("other")) return;
      pending = route;
      return;
    }
    if (path === "/messages" && req.method() === "GET") {
      const narrow = JSON.parse(u.searchParams.get("narrow") || "[]"),
        term = narrow.find((n) => n.operator === "search")?.operand;
      if (term === "slow") await new Promise((r) => setTimeout(r, 350));
      const anchor = u.searchParams.get("anchor"),
        search = narrow.some((n) =>
          ["search", "has", "after", "before", "is"].includes(n.operator),
        );
      if (u.hostname.startsWith("other"))
        return reply(route, {
          messages: [],
          found_oldest: true,
          found_newest: true,
        });
      if (!search && !narrow.some((n) => n.operator === "stream"))
        return reply(route, {
          messages: [],
          found_oldest: true,
          found_newest: true,
        });
      const count = Number(u.searchParams.get("num_before")),
        after = Number(u.searchParams.get("num_after"));
      const end = anchor === "newest" ? 300 : Number(anchor) - (after ? 0 : 1),
        start = Math.max(1, end - Math.min(count, 50) + 1);
      const data = after
        ? [
            message(Number(anchor) - 1, "Moved", 2),
            message(Number(anchor), "Moved", 2),
            message(Number(anchor) + 1, "Moved", 2),
          ]
        : Array.from({ length: end - start + 1 }, (_, i) => message(start + i));
      if (term)
        data.forEach(
          (m) =>
            (m.content = `<p>${term} message ${m.id}</p><img src=x onerror=alert(1)>`),
        );
      return reply(route, {
        messages: subscriptions.includes(1) || after ? data : [],
        found_oldest: start === 1 || !subscriptions.includes(1),
        found_newest: true,
      });
    }
    if (/^\/messages\/\d+$/.test(path)) {
      if (req.method() === "GET")
        return reply(route, {
          message: message(
            Number(path.split("/").at(-1)),
            Number(path.split("/").at(-1)) === 299 ? "Moved" : topic,
            Number(path.split("/").at(-1)) === 299 ? 2 : 1,
          ),
        });
      topic = body.get("topic");
      await reply(route, {});
      await emit({
        type: "update_message",
        message_id: Number(path.split("/").at(-1)),
        message_ids: [300],
        stream_id: 1,
        orig_subject: "Thread",
        subject: topic,
        propagate_mode: body.get("propagate_mode"),
      });
      return;
    }
    if (path === "/users/me/1/topics")
      return reply(route, { topics: [{ name: topic, max_id: 300 }] });
    if (path === "/user_topics") {
      muted = body.get("visibility_policy") === "1";
      followed = body.get("visibility_policy") === "3";
      await reply(route, {});
      await emit({
        type: "user_topic",
        stream_id: 1,
        topic_name: topic,
        visibility_policy: Number(body.get("visibility_policy")),
      });
      return;
    }
    if (path === "/user_groups") return reply(route, { user_groups: groups });
    if (path === "/users") return reply(route, { members: users });
    if (path === "/streams") return reply(route, { streams: channels });
    if (path === "/users/me/subscriptions" && req.method() === "GET")
      return reply(route, {
        subscriptions: channels.filter((c) =>
          subscriptions.includes(c.stream_id),
        ),
      });
    if (/^\/streams\/\d+\/members$/.test(path))
      return reply(route, { subscribers: [1, 2] });
    if (/^\/streams\/\d+$/.test(path)) {
      const c = channels.find(
        (c) => c.stream_id === Number(path.split("/").at(-1)),
      );
      if (req.method() === "GET") return reply(route, { stream: c });
      if (failChannel) {
        failChannel = false;
        return route.fulfill({
          status: 403,
          json: { result: "error", msg: "Synthetic permission rejection" },
          headers,
        });
      }
      if (body.has("new_name")) c.name = body.get("new_name");
      if (body.has("description")) c.description = body.get("description");
      if (body.has("is_private"))
        c.invite_only = body.get("is_private") === "true";
      return reply(route, {});
    }
    if (path === "/users/me/subscriptions") {
      const names = JSON.parse(body.get("subscriptions")),
        join = req.method() === "POST",
        affected = channels.filter((c) =>
          names.some((n) => (typeof n === "string" ? n : n.name) === c.name),
        );
      if (!body.has("principals")) {
        subscriptions = join
          ? [
              ...new Set([
                ...subscriptions,
                ...affected.map((c) => c.stream_id),
              ]),
            ]
          : subscriptions.filter(
              (id) => !affected.some((c) => c.stream_id === id),
            );
        await reply(route, {});
        await emit({
          type: "subscription",
          op: join ? "add" : "remove",
          subscriptions: affected,
        });
        return;
      }
      return reply(route, {});
    }
    if (path === "/channels/create") {
      const c = {
        stream_id: 3,
        name: body.get("name"),
        description: body.get("description"),
        invite_only: body.get("invite_only") === "true",
      };
      channels.push(c);
      subscriptions.push(3);
      await reply(route, {});
      await emit({ type: "subscription", op: "add", subscriptions: [c] });
      return;
    }
    if (path === "/invites" && req.method() === "GET")
      return reply(route, {
        invites: [
          {
            id: 1,
            email: "invited@fixture.invalid",
            is_multiuse: false,
            invited_as: 400,
            invited_by_user_id: 1,
            expiry_date: 1800000000,
          },
        ],
      });
    if (path.startsWith("/invites")) return reply(route, {});
    if (/^\/users\/\d+$/.test(path)) {
      const member = users.find(
        (u) => u.user_id === Number(path.split("/").at(-1)),
      );
      if (req.method() === "PATCH") {
        if (body.has("full_name")) member.full_name = body.get("full_name");
        if (body.has("role")) member.role = Number(body.get("role"));
      } else if (req.method() === "DELETE") member.is_active = false;
      await reply(route, {});
      await emit({ type: "realm_user", op: "update", person: member });
      return;
    }
    if (path === "/user_groups/7/members") {
      const ids = JSON.parse(body.get("add") || body.get("delete"));
      groups[0].members = body.has("add")
        ? [...new Set([...groups[0].members, ...ids])]
        : groups[0].members.filter((id) => !ids.includes(id));
      return reply(route, {});
    }
    if (path === "/realm/user_settings_defaults") {
      for (const [k, v] of body) defaults[k] = v === "true";
      return reply(route, {});
    }
    return reply(route, {});
  },
);
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", {
      name: "private-room (private channel)",
      exact: true,
    }),
  ).toBeVisible();
  if (!(await page.locator("#sidebar-tools-list").isVisible()))
    await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .getByRole("button", { name: "Search messages", exact: true })
    .first()
    .click();
  const panel = page.getByRole("region", { name: "Message search" });
  await panel.getByLabel("Search message text").fill("slow");
  await panel
    .getByRole("button", { name: "Search messages", exact: true })
    .click();
  await panel.getByLabel("Search message text").fill("fast");
  await panel
    .getByRole("button", { name: "Search messages", exact: true })
    .click();
  await expect(panel.locator("article")).toHaveCount(50);
  await expect(panel.locator("article").first()).toContainText("fast message");
  await page.waitForTimeout(450);
  await expect(panel.locator("article").first()).not.toContainText(
    "slow message",
  );
  await panel.locator("article").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(panel.locator("article").nth(1)).toBeFocused();
  await panel
    .getByRole("button", { name: "Open message 299 in context" })
    .click();
  await expect(
    page.getByLabel("Result in context").locator("article"),
  ).toHaveCount(3);
  await expect(page.locator('[data-search-id="299"]')).toBeFocused();
  await expect(panel).toContainText("Moved");
  await panel.getByRole("button", { name: "Back to results" }).click();
  for (let i = 0; i < 4; i++) {
    await panel.getByRole("button", { name: "Older results" }).click();
    await expect(
      panel.getByRole("button", { name: "Older results" }),
    ).toBeEnabled();
  }
  await expect(panel.locator("article")).toHaveCount(200);
  await page
    .getByRole("button", { name: "Open Other (other.zulip.test)", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Message search" }),
  ).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("fast message");
  await page
    .getByRole("button", {
      name: "Open Fixture (fixture.zulip.test)",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "private-room (private channel)",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Thread options: Thread", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Thread options: Thread", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Follow topic", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Thread options: Thread", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Unfollow topic" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Mute topic on server" }).click();
  await page
    .getByRole("button", { name: "Thread options: Thread", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Rename, move or resolve topic" })
    .click();
  const editor = page.getByRole("dialog", { name: "Manage topic" });
  await expect(editor).toBeVisible();
  await editor.getByLabel("New topic").fill("Renamed");
  await editor.getByRole("button", { name: "Apply topic change" }).click();
  await expect(editor).toHaveCount(0);
  expect(
    writes.find((w) => w.path === "/messages/300").body.propagate_mode,
  ).toBe("change_all");
  if (!(await page.locator("#sidebar-tools-list").isVisible()))
    await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .getByRole("button", { name: "Channel directory", exact: true })
    .click();
  await page
    .getByRole("button", { name: "public-room · Public", exact: true })
    .click();
  await page.getByRole("button", { name: "Join channel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Leave channel", exact: true }),
  ).toBeVisible();
  failChannel = true;
  await page
    .getByLabel("Description", { exact: true })
    .fill("Changed description");
  await page.getByRole("button", { name: "Save channel settings" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic permission rejection",
  );
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "Changed description",
  );
  await page.getByRole("button", { name: "Save channel settings" }).click();
  await expect(
    page
      .locator("p")
      .filter({ hasText: /^Changed description$/ })
      .first(),
  ).toBeVisible();
  await page.getByLabel("Visibility", { exact: true }).selectOption("true");
  await page.getByRole("button", { name: "Save channel settings" }).click();
  await expect
    .poll(() => writes.some((w) => w.body.is_private === "true"))
    .toBe(true);
  if (!(await page.locator("#sidebar-tools-list").isVisible()))
    await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .getByRole("button", { name: "Organisation controls", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Fixture Member · ID 2 · Member",
      exact: true,
    })
    .click();
  await page.getByLabel("Member role").selectOption("300");
  await page.getByRole("button", { name: "Save member", exact: true }).click();
  await expect.poll(() => users[1].role).toBe(300);
  await page.getByRole("button", { name: "Invitations", exact: true }).click();
  await page.getByLabel("Email addresses").fill("new@fixture.invalid");
  await page
    .getByRole("button", { name: "Send invitations", exact: true })
    .click();
  await expect
    .poll(() =>
      writes.some((w) => w.path === "/invites" && w.body.invite_as === "400"),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Groups", exact: true }).click();
  await page
    .getByRole("button", { name: "Editors · 1 direct members", exact: true })
    .click();
  await page.getByLabel("Member IDs", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Add group members", exact: true })
    .click();
  await expect.poll(() => groups[0].members.includes(2)).toBe(true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Mobile notifications for channel messages").check();
  await page.getByRole("button", { name: "Save new-user defaults" }).click();
  await expect.poll(() => defaults.enable_stream_push_notifications).toBe(true);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole("button", { name: "Toggle channels" }).click();
  if (!(await page.locator("#sidebar-tools-list").isVisible()))
    await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .getByRole("button", { name: "Search messages", exact: true })
    .first()
    .click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/mobile-open/);
  await expect(page.getByLabel("Search message text")).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Back to conversation" }).click();
  await expect(panel).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (!(await page.locator("#sidebar-tools-list").isVisible()))
    await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .getByRole("button", { name: "Search messages", exact: true })
    .first()
    .click();
  await panel.getByLabel("Search message text").fill("permission");
  await panel
    .getByRole("button", { name: "Search messages", exact: true })
    .click();
  await expect(panel.locator("article")).toHaveCount(50);
  subscriptions = subscriptions.filter((id) => id !== 1);
  await emit({
    type: "subscription",
    op: "remove",
    subscriptions: [channels[0]],
  });
  await expect(panel.locator("article")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Remove organization", exact: true })
    .click();
  await expect(page.locator("body")).not.toContainText("permission message");
  expect(errors).toEqual([]);
  expect(blocked).toEqual([]);
  console.log(
    "PASS search races/pagination/context/keyboard, account isolation, server topic preferences and moves, channel joins/settings/privacy/errors, roles/invites/groups/defaults, 320px navigation, private membership invalidation and account removal. All writes intercepted.",
  );
} catch (error) {
  console.error(await page.locator(".main-pane").innerText());
  console.error(errors);
  console.error(writes.slice(-4));
  throw error;
} finally {
  await browser.close();
}
