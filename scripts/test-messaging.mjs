// Every organization request is intercepted. The only network destination is localhost.
import { chromium, expect } from "@playwright/test";
const app = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4181";
if (!["127.0.0.1", "localhost"].includes(new URL(app).hostname))
  throw new Error("Local fixtures only.");
const org = "https://messaging-fixture.invalid";
const account = {
  id: `${org}|1`,
  url: org,
  email: "fixture@test.invalid",
  apiKey: "synthetic",
  name: "Fixture",
  userId: 1,
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
});
context.setDefaultTimeout(10000);
const page = await context.newPage();
const errors = [],
  blocked = [],
  writes = [],
  events = [];
let eventId = 0,
  failUpload = true,
  failSchedule = true,
  failDelete = true;
let snippets = [],
  scheduled = [],
  reminders = [];
const messages = [
  {
    id: 1,
    sender_id: 1,
    sender_full_name: "Fixture Owner",
    timestamp: 1700000000,
    content: "<p>Original message</p>",
    type: "stream",
    stream_id: 1,
    subject: "Thread",
    display_recipient: "room",
    avatar_url: null,
    reactions: [],
    flags: ["read"],
    submessages: [],
  },
  {
    id: 2,
    sender_id: 2,
    sender_full_name: "Alice",
    timestamp: 1700000600,
    content: "<p>Lunch?</p>",
    type: "stream",
    stream_id: 1,
    subject: "Thread",
    display_recipient: "room",
    avatar_url: null,
    reactions: [],
    flags: [],
    submessages: [
      {
        id: 1,
        message_id: 2,
        sender_id: 2,
        msg_type: "widget",
        content: JSON.stringify({
          widget_type: "poll",
          extra_data: { question: "Lunch?", options: ["Soup", "Salad"] },
        }),
      },
    ],
  },
];
const enqueue = (e) => events.push({ ...e, id: ++eventId });
page.on("pageerror", (e) => errors.push(e.message));
await context.addInitScript((a) => {
  if (!sessionStorage.getItem("initialized")) {
    localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify([a]));
    sessionStorage.setItem("initialized", "true");
  }
}, account);
await context.route("**/*", async (route) => {
  const req = route.request(),
    u = new URL(req.url()),
    method = req.method(),
    path = u.pathname.replace("/api/v1", "");
  if (u.origin === new URL(app).origin) return route.continue();
  if (u.origin !== org) {
    blocked.push(req.url());
    return route.abort();
  }
  if (method === "OPTIONS")
    return route.fulfill({
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE",
        "access-control-allow-headers": "authorization,content-type",
      },
    });
  if (!u.pathname.startsWith("/api/v1/")) {
    expect(req.headers().authorization).toBeUndefined();
    return route.fulfill({ status: 204 });
  }
  expect(req.headers().authorization).toBe(
    `Basic ${Buffer.from(`${account.email}:${account.apiKey}`).toString("base64")}`,
  );
  const p = new URLSearchParams(req.postData() || "");
  if (method !== "GET" && path !== "/register" && path !== "/events")
    writes.push({ path, method, params: Object.fromEntries(p) });
  let d = { result: "success", msg: "" },
    status = 200;
  const fail = (message) => {
    status = 400;
    d = { result: "error", msg: message };
  };
  if (path === "/register")
    d = {
      ...d,
      queue_id: "fixture",
      last_event_id: eventId,
      zulip_feature_level: 420,
      max_file_upload_size_mib: 1,
      max_message_length: 10000,
      max_topic_length: 60,
      realm_name: "Fixture",
      subscriptions: [
        {
          stream_id: 1,
          name: "room",
          invite_only: true,
          description: "Fixture",
        },
      ],
      realm_users: [
        {
          user_id: 1,
          full_name: "Fixture Owner",
          email: account.email,
          is_active: true,
          is_bot: false,
          role: 100,
        },
        {
          user_id: 2,
          full_name: "Alice",
          email: "alice@test.invalid",
          is_active: true,
          is_bot: false,
        },
      ],
    };
  else if (path === "/events") {
    await new Promise((r) => setTimeout(r, 100));
    d.events = events.splice(0);
  } else if (path.endsWith("/topics"))
    d.topics = [{ name: "Thread", max_id: 2 }];
  else if (path === "/messages" && method === "GET")
    d = { ...d, messages, found_oldest: true, found_newest: true };
  else if (path === "/messages" && method === "POST") d.id = 3;
  else if (path === "/messages/render")
    d.rendered =
      '<p><strong>Preview fixture</strong><img src="x" onerror="window.previewXss=1"><script>window.previewXss=1</script></p>';
  else if (path === "/messages/1/history")
    d.message_history = [
      {
        timestamp: 1700000000,
        user_id: 1,
        content: "old",
        rendered_content: "<p>Old version</p>",
      },
    ];
  else if (path === "/messages/flags") {
    const op = p.get("op"),
      flag = p.get("flag");
    enqueue({ type: "update_message_flags", messages: [1], op, flag });
  } else if (/^\/messages\/\d+$/.test(path)) {
    const m = messages.find((m) => m.id === Number(path.split("/").at(-1)));
    if (method === "DELETE") {
      if (failDelete) fail("Deletion not permitted");
      else enqueue({ type: "delete_message", message_id: m.id });
    } else
      d.message = {
        ...m,
        content:
          u.searchParams.get("apply_markdown") === "false"
            ? "Original **Markdown**"
            : m.content,
      };
  } else if (path === "/realm/emoji")
    d.emoji = {
      1: { name: "company", deactivated: false },
      2: { name: "company_old", deactivated: true },
    };
  else if (path === "/user_uploads") {
    if (failUpload) {
      failUpload = false;
      fail("Upload temporarily unavailable");
    } else d.url = "/user_uploads/1/fixture.txt";
  } else if (path === "/drafts") {
    if (method === "GET") d.drafts = [];
    else d.ids = [1];
  } else if (path === "/submessage") {
    const m = messages.find((m) => m.id === Number(p.get("message_id")));
    const s = {
      id: m.submessages.length + 1,
      sender_id: 1,
      message_id: m.id,
      msg_type: "widget",
      content: p.get("content"),
    };
    m.submessages.push(s);
    enqueue({ ...s, type: "submessage", submessage_id: s.id });
  } else if (path.startsWith("/saved_snippets")) {
    if (method === "GET") d.saved_snippets = snippets;
    else if (method === "POST") {
      snippets.push({
        id: 1,
        title: p.get("title"),
        content: p.get("content"),
      });
      d.saved_snippet_id = 1;
    } else if (method === "PATCH")
      Object.assign(snippets[0], Object.fromEntries(p));
    else snippets = [];
  } else if (path.startsWith("/scheduled_messages")) {
    if (method === "GET") d.scheduled_messages = scheduled;
    else if (method === "POST") {
      if (failSchedule) {
        failSchedule = false;
        fail("Scheduling temporarily unavailable");
      } else {
        scheduled.push({
          scheduled_message_id: 1,
          type: p.get("type"),
          to: Number(p.get("to")),
          topic: p.get("topic"),
          content: p.get("content"),
          scheduled_delivery_timestamp: Number(
            p.get("scheduled_delivery_timestamp"),
          ),
          failed: true,
        });
        d.scheduled_message_id = 1;
      }
    } else if (method === "PATCH")
      Object.assign(scheduled[0], {
        content: p.get("content"),
        scheduled_delivery_timestamp: Number(
          p.get("scheduled_delivery_timestamp"),
        ),
        failed: false,
      });
    else scheduled = [];
  } else if (path.startsWith("/reminders")) {
    if (method === "GET") d.reminders = reminders;
    else if (method === "POST") {
      const id = reminders.length + 1;
      reminders.push({
        reminder_id: id,
        type: "private",
        to: [1],
        content: p.get("note") || "Reminder",
        reminder_target_message_id: Number(p.get("message_id")),
        scheduled_delivery_timestamp: Number(
          p.get("scheduled_delivery_timestamp"),
        ),
        failed: false,
      });
      d.reminder_id = id;
    } else
      reminders = reminders.filter(
        (r) => r.reminder_id !== Number(path.split("/").at(-1)),
      );
  }
  await route.fulfill({
    status,
    json: d,
    headers: { "access-control-allow-origin": "*" },
  });
});
try {
  await page.goto(app);
  const openRoom = () =>
    page
      .getByRole("button", { name: "room (private channel)", exact: true })
      .click();
  await openRoom();
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("persistent fixture");
  await page.getByLabel("Thread topic", { exact: true }).fill("Thread");
  await page.reload();
  await openRoom();
  await expect(composer).toHaveValue("persistent fixture");
  await composer.fill("@Ali");
  await composer.press("ArrowDown");
  await composer.press("Enter");
  await expect(composer).toHaveValue("@**Alice|2** ");
  expect(writes.filter((w) => w.path === "/messages")).toHaveLength(0);
  await composer.fill(":comp");
  await expect(
    page.getByRole("option", { name: ":company:", exact: true }),
  ).toBeVisible();
  await composer.press("Tab");
  await expect(composer).toHaveValue(":company: ");
  await composer.fill("IME fixture");
  await composer.dispatchEvent("keydown", {
    key: "Enter",
    keyCode: 229,
    isComposing: true,
  });
  expect(writes.filter((w) => w.path === "/messages")).toHaveLength(0);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Markdown preview" }),
  ).toContainText("Preview fixture");
  expect(await page.evaluate(() => window.previewXss)).toBeUndefined();
  await page.getByRole("button", { name: "Close preview" }).click();
  await page.getByLabel("Attach files", { exact: true }).setInputFiles({
    name: "fixture.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("fixture"),
  });
  await expect(
    page.getByRole("button", { name: "Retry upload" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry upload" }).click();
  await expect(composer).toHaveValue(/user_uploads\/1\/fixture.txt/);
  const poll = page.getByRole("region", { name: "Poll", exact: true });
  await poll.getByRole("button", { name: "Soup (0)" }).click();
  await expect(poll.getByRole("button", { name: "Soup (1)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const row = page.locator('[data-message-id="1"]');
  await row.getByRole("button", { name: "Message tools" }).click();
  await row.getByRole("button", { name: "Star", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Unstar", exact: true }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Mark unread" }).click();
  await expect(
    row.getByRole("status").filter({ hasText: "Marked unread." }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Edit history", exact: true }).click();
  await expect(row.getByRole("region", { name: "Edit history" })).toContainText(
    "Old version",
  );
  await row.getByRole("button", { name: "Quote reply" }).click();
  await expect(composer).toHaveValue(/> Original \*\*Markdown\*\*/);
  await row
    .getByRole("button", { name: "Delete message", exact: true })
    .click();
  await row.getByRole("button", { name: "Confirm delete" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Deletion not permitted" }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Cancel", exact: true }).click();
  await row.getByLabel(/Remind me/).fill("2090-01-01T12:00");
  await row.getByLabel("Reminder note", { exact: true }).fill("fixture note");
  await row.getByRole("button", { name: "Create reminder" }).click();
  await expect(
    row.getByText("Reminder scheduled on the server."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Snippets", exact: true }).click();
  const snippetPanel = page.getByRole("region", {
    name: "Saved snippets",
    exact: true,
  });
  await snippetPanel.getByLabel("Snippet title").fill("Fixture snippet");
  await snippetPanel
    .getByLabel("Content", { exact: true })
    .fill("Snippet content");
  await snippetPanel
    .getByRole("button", { name: "Save snippet", exact: true })
    .click();
  await expect(
    snippetPanel.getByRole("button", { name: "Insert snippet" }),
  ).toBeVisible();
  await snippetPanel.getByRole("button", { name: "Insert snippet" }).click();
  await expect(composer).toHaveValue(/Snippet content/);
  await snippetPanel
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Scheduled messages", exact: true })
    .click();
  const schedulePanel = page.getByRole("region", {
    name: "Scheduled messages",
    exact: true,
  });
  await schedulePanel.getByLabel(/Delivery time/).fill("2090-01-01T12:00");
  await schedulePanel
    .getByRole("button", { name: "Schedule message", exact: true })
    .click();
  await expect(schedulePanel.getByRole("alert")).toContainText(
    "Scheduling temporarily unavailable",
  );
  await expect(
    schedulePanel.getByLabel("Content", { exact: true }),
  ).toHaveValue(/Snippet content/);
  await schedulePanel
    .getByRole("button", { name: "Schedule message", exact: true })
    .click();
  await expect(
    schedulePanel.getByText("Delivery failed. Edit the time and retry."),
  ).toBeVisible();
  await schedulePanel
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await schedulePanel
    .getByLabel("Content", { exact: true })
    .fill("Edited scheduled fixture");
  await schedulePanel.getByRole("button", { name: "Save changes" }).click();
  await expect(
    schedulePanel.getByText("Edited scheduled fixture", { exact: true }),
  ).toBeVisible();
  await schedulePanel
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Poll / to-do", exact: true }).click();
  const builder = page.getByRole("region", {
    name: "Create interactive message",
  });
  await builder.getByLabel("Type", { exact: true }).selectOption("todo");
  await builder.getByLabel("Question or title").fill("Fixture tasks");
  await builder.getByLabel("Options or tasks (one per line)").fill("One\nTwo");
  await builder
    .getByRole("button", { name: "Prepare interactive draft" })
    .click();
  await expect(composer).toHaveValue("/todo Fixture tasks\n- One\n- Two");
  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  const drafts = page.getByRole("region", {
    name: "Saved drafts",
    exact: true,
  });
  await expect(drafts.getByText(/Snippet content/).first()).toBeVisible();
  await drafts.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeInViewport();
  enqueue({
    type: "subscription",
    op: "remove",
    subscriptions: [{ stream_id: 1, name: "room" }],
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter((k) =>
            k.startsWith("zoomerlip.draft.v1."),
          ).length,
      ),
    )
    .toBe(0);
  expect(errors).toEqual([]);
  expect(blocked).toEqual([]);
  console.log(
    "Messaging browser fixtures passed: drafts, autocomplete/IME, uploads, preview safety, actions, reminders, snippets, scheduling, polls, mobile layout and access revocation.",
  );
} finally {
  await browser.close();
}
