// Every organization request is intercepted. Never writes to a real organization.
import { chromium, expect } from "@playwright/test";
const url = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4183";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Use a local fixture server.");
const account = {
  id: "https://notification-fixture.test|1",
  url: "https://notification-fixture.test",
  email: "fixture@test.invalid",
  apiKey: "synthetic",
  userId: 1,
  name: "Fixture",
};
const other = {
  ...account,
  id: "https://other-fixture.test|1",
  url: "https://other-fixture.test",
  name: "Other",
};
const user = {
  user_id: 1,
  full_name: "Fixture User",
  email: account.email,
  is_active: true,
  is_bot: false,
};
const peer = { ...user, user_id: 2, full_name: "Fixture Peer" };
const message = {
  id: 50,
  sender_id: 2,
  sender_full_name: peer.full_name,
  timestamp: Date.now() / 1000,
  avatar_url: null,
  content: "<p>Private fixture message</p>",
  type: "stream",
  stream_id: 1,
  subject: "Thread",
  display_recipient: "private-room",
  reactions: [],
  flags: [],
};
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disable-gpu"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
context.setDefaultTimeout(10000);
const calls = [],
  errors = [],
  queues = new Map();
let eventId = 0,
  queueId = 0;
await context.addInitScript(
  ({ account, other }) => {
    localStorage.setItem(
      "zoomerlip.accounts.v1",
      JSON.stringify([account, other]),
    );
    window.notifications = [];
    window.permissionRequests = 0;
    window.fixtureFocus = true;
    Object.defineProperty(document, "hasFocus", {
      value: () => window.fixtureFocus,
    });
    window.Notification = class {
      static permission = "default";
      static async requestPermission() {
        window.permissionRequests++;
        this.permission = "granted";
        return "granted";
      }
      constructor(title, options) {
        this.title = title;
        this.options = options;
        window.notifications.push(this);
      }
      close() {
        this.closed = true;
        this.onclose?.();
      }
    };
  },
  { account, other },
);
await context.route("**/*", (route) =>
  new URL(route.request().url()).origin === new URL(url).origin
    ? route.continue()
    : route.abort(),
);
await context.route(
  /https:\/\/(notification-fixture|other-fixture)\.test\/.*/,
  async (route) => {
    const r = route.request(),
      u = new URL(r.url()),
      path = u.pathname;
    const body = Object.fromEntries(new URLSearchParams(r.postData() || ""));
    calls.push({
      origin: u.origin,
      path,
      method: r.method(),
      body,
      search: u.searchParams.toString(),
    });
    let data = { result: "success", msg: "" };
    if (path.endsWith("/register")) {
      const q = String(++queueId);
      queues.set(q, { org: u.origin, events: [], waiting: null });
      data = {
        ...data,
        queue_id: q,
        last_event_id: eventId,
        zulip_feature_level: 300,
        realm_name: u.origin === account.url ? "Fixture" : "Other",
        subscriptions: [
          {
            stream_id: 1,
            name: "private-room",
            description: "Fixture",
            invite_only: true,
          },
        ],
        realm_users: [user, peer],
        user_status: {
          2: { status_text: "Focusing", emoji_name: "headphones" },
        },
        user_settings: {
          presence_enabled: true,
          send_private_typing_notifications: true,
          send_stream_typing_notifications: true,
          enable_desktop_notifications: true,
          enable_sounds: false,
        },
        server_typing_started_wait_period_milliseconds: 1000,
        server_typing_stopped_wait_period_milliseconds: 1000,
        server_typing_started_expiry_period_milliseconds: 1000,
      };
    } else if (path.endsWith("/events") && r.method() === "GET") {
      const q = queues.get(u.searchParams.get("queue_id"));
      if (!q)
        return route.fulfill({
          status: 400,
          json: { result: "error", code: "BAD_EVENT_QUEUE_ID" },
        });
      if (!q.events.length)
        await new Promise((resolve) => {
          q.waiting = resolve;
        });
      data.events = q.events.splice(0);
    } else if (path.endsWith("/users/me/presence"))
      data = {
        ...data,
        presence_last_update_id: 4,
        presences: {
          2: {
            active_timestamp: Date.now() / 1000,
            idle_timestamp: Date.now() / 1000,
          },
        },
      };
    else if (path.endsWith("/topics"))
      data.topics = [{ name: "Thread", max_id: 50 }];
    else if (path.endsWith("/messages"))
      data = {
        ...data,
        messages: u.searchParams.get("narrow")?.includes("stream")
          ? [message]
          : [],
        found_oldest: true,
        found_newest: true,
      };
    else if (path.endsWith("/read_receipts")) data.user_ids = [2];
    else if (/\/messages\/\d+$/.test(path)) data.message = message;
    else if (path.endsWith("/users/me")) data = { ...data, ...user };
    try {
      await route.fulfill({
        json: data,
        headers: { "access-control-allow-origin": "*" },
      });
    } catch {
      /* Page was closed. */
    }
  },
);
async function emit(org, events) {
  for (const q of queues.values())
    if (q.org === org) {
      q.events.push(...events.map((e) => ({ ...e, id: ++eventId })));
      q.waiting?.();
      q.waiting = null;
    }
}
async function openChannel(page) {
  await page
    .getByRole("button", {
      name: "private-room (private channel)",
      exact: true,
    })
    .click();
  await page.locator('button.topic[aria-label="Thread"]').click();
}
try {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await openChannel(page);
  expect(await page.evaluate(() => window.permissionRequests)).toBe(0);
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("typing fixture");
  await expect
    .poll(
      () =>
        calls.filter((c) => c.path.endsWith("/typing") && c.body.op === "start")
          .length,
    )
    .toBe(1);
  await composer.blur();
  await expect
    .poll(() =>
      calls.some((c) => c.path.endsWith("/typing") && c.body.op === "stop"),
    )
    .toBe(true);
  expect(
    calls
      .filter((c) => c.path.endsWith("/typing"))
      .every((c) => c.origin === account.url),
  ).toBe(true);
  await emit(other.url, [
    {
      type: "typing",
      op: "start",
      message_type: "stream",
      stream_id: 1,
      topic: "Thread",
      sender: { user_id: 2 },
    },
  ]);
  await expect(page.locator(".typing-indicator")).toBeEmpty();
  await emit(account.url, [
    {
      type: "typing",
      op: "start",
      message_type: "stream",
      stream_id: 1,
      topic: "Thread",
      sender: { user_id: 2 },
    },
  ]);
  await expect(page.locator(".typing-indicator")).toContainText(
    "Fixture Peer is typing",
  );
  await expect(page.locator(".typing-indicator")).toBeEmpty({ timeout: 4000 });
  await page.locator(".message").hover();
  await page
    .getByRole("button", { name: "Read receipts", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Read receipts" }),
  ).toContainText("Fixture Peer");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  await page.getByText("Status and availability", { exact: true }).click();
  await page.getByLabel("Status text", { exact: true }).fill("Fixture status");
  await page.getByRole("button", { name: "Save status", exact: true }).click();
  await expect(page.getByText("Status saved.", { exact: true })).toBeVisible();
  await page.getByText("Notifications and privacy", { exact: true }).click();
  await page
    .getByRole("button", { name: "Enable notifications on this device" })
    .click();
  expect(await page.evaluate(() => window.permissionRequests)).toBe(1);
  await page.evaluate(() => {
    window.fixtureFocus = false;
    window.dispatchEvent(new Event("blur"));
  });
  const second = await context.newPage();
  second.on("pageerror", (e) => errors.push(e.message));
  await second.goto(url);
  await expect(
    second.getByRole("button", { name: "My profile", exact: true }),
  ).toBeVisible();
  await second.evaluate(() => {
    window.Notification.permission = "granted";
    window.fixtureFocus = false;
    window.dispatchEvent(new Event("blur"));
  });
  await expect
    .poll(
      () => [...queues.values()].filter((q) => q.org === account.url).length,
    )
    .toBe(2);
  const dm = {
    ...message,
    id: 90,
    type: "private",
    stream_id: undefined,
    display_recipient: [
      { id: 1, full_name: user.full_name, email: user.email },
      { id: 2, full_name: peer.full_name, email: peer.email },
    ],
  };
  await emit(account.url, [{ type: "message", flags: [], message: dm }]);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.notifications.length)) +
        (await second.evaluate(() => window.notifications.length)),
    )
    .toBe(1);
  const previews = [
    ...(await page.evaluate(() =>
      window.notifications.map((n) => [n.title, n.options.body]),
    )),
    ...(await second.evaluate(() =>
      window.notifications.map((n) => [n.title, n.options.body]),
    )),
  ];
  expect(previews).toEqual([
    ["Zoomerlip", "New message. Open Zoomerlip to read it."],
  ]);
  await emit(account.url, [
    { type: "message", flags: [], message: { ...dm, id: 91 } },
    { type: "update_message_flags", op: "add", flag: "read", messages: [91] },
  ]);
  await page.waitForTimeout(1100);
  expect(
    (await page.evaluate(() => window.notifications.length)) +
      (await second.evaluate(() => window.notifications.length)),
  ).toBe(1);
  await page.evaluate(
    ({ id }) =>
      window.dispatchEvent(
        new CustomEvent("zoomerlip-notification-open", {
          detail: { accountId: id, messageId: 50 },
        }),
      ),
    other,
  );
  await expect(page.locator(".conversation-header")).toContainText("Thread");
  await expect
    .poll(() =>
      calls.some(
        (c) =>
          c.origin === other.url &&
          c.path.endsWith("/messages") &&
          c.search.includes("anchor=50"),
      ),
    )
    .toBe(true);
  // A notification for the active organisation must also dismiss a search panel.
  if (!(await page.locator("#sidebar-tools-list").isVisible()))
    await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .getByRole("button", { name: "Search messages", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "Message search" }),
  ).toBeVisible();
  await page.evaluate(
    ({ id }) =>
      window.dispatchEvent(
        new CustomEvent("zoomerlip-notification-open", {
          detail: { accountId: id, messageId: 50 },
        }),
      ),
    other,
  );
  await expect(
    page.getByRole("region", { name: "Message search" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "Notification browser fixtures passed: typing, isolation, expiry, status, receipts, explicit permission, private previews, two-tab deduplication, read suppression, account-aware navigation and mobile width.",
  );
} finally {
  for (const q of queues.values()) q.waiting?.();
  await context.close();
  await browser.close();
}
