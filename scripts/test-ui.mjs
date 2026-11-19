// Isolated browser fixture. All Zulip requests are intercepted; no real org is contacted.
import { chromium, expect } from "@playwright/test";
const url = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4173";
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Local client only.");
const account = {
  id: "https://fixture.zulip.test|1",
  url: "https://fixture.zulip.test",
  email: "fixture@test.invalid",
  apiKey: "synthetic",
  name: "Fixture",
  userId: 1,
};
const messages = Array.from({ length: 300 }, (_, i) => ({
  id: i + 1,
  sender_id: 1,
  sender_full_name: "Fixture User",
  avatar_url: null,
  timestamp: 1700000000 + i * 400,
  content: `<p>Message ${i + 1}</p>`,
  type: "stream",
  stream_id: 1,
  subject: "Thread",
  display_recipient: "private-room",
  reactions: [],
}));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
context.setDefaultTimeout(10000);
const page = await context.newPage();
const errors = [],
  blocked = [];
page.on("pageerror", (e) => errors.push(e.message));
let edits = 0,
  eventCalls = 0;
await context.addInitScript((a) => {
  if (!["127.0.0.1", "localhost"].includes(location.hostname)) return;
  localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify([a]));
  window.dateFormats = 0;
  for (const name of ["toLocaleTimeString", "toLocaleDateString"]) {
    const original = Date.prototype[name];
    Date.prototype[name] = function (...args) {
      window.dateFormats++;
      return original.apply(this, args);
    };
  }
}, account);
await context.route("**/*", (route) => {
  if (new URL(route.request().url()).origin === new URL(url).origin)
    return route.continue();
  blocked.push(route.request().url());
  return route.abort();
});
await context.route("https://fixture.zulip.test/**", async (route) => {
  const request = route.request(),
    u = new URL(request.url()),
    path = u.pathname;
  let data = { result: "success", msg: "" };
  if (path.endsWith("/register"))
    data = {
      ...data,
      queue_id: "fixture-queue",
      last_event_id: 0,
      realm_name: "Fixture",
      unread_msgs: {
        streams: [
          {
            stream_id: 1,
            topic: "Thread",
            unread_message_ids: [298, 299, 300],
          },
        ],
      },
      subscriptions: [
        {
          stream_id: 1,
          name: "private-room",
          description: "Private fixture",
          invite_only: true,
        },
      ],
      realm_users: Array.from({ length: 1000 }, (_, i) => ({
        user_id: i + 1,
        full_name: i === 0 ? "Fixture User" : `Member ${i}`,
        is_active: true,
        is_bot: false,
        email: `member${i}@test.invalid`,
        role: i === 0 ? 100 : 400,
      })),
    };
  else if (path.endsWith("/events")) {
    if (eventCalls++ === 0)
      data = { ...data, events: [{ id: 1, type: "heartbeat" }] };
    else return;
  } else if (path.endsWith("/topics"))
    data = { ...data, topics: [{ name: "Thread", max_id: 300 }] };
  else if (path.endsWith("/messages")) {
    if (request.method() === "POST")
      await new Promise((resolve) => setTimeout(resolve, 250));
    const narrow = JSON.parse(u.searchParams.get("narrow") || "[]");
    data = {
      ...data,
      messages: narrow.some((n) => n.operator === "stream") ? messages : [],
      found_oldest: true,
    };
  } else if (/\/messages\/\d+$/.test(path)) {
    if (request.method() === "PATCH") edits++;
    else
      data = {
        ...data,
        message: { ...messages.at(-1), content: "Message 300" },
      };
  }
  await route.fulfill({
    json: data,
    headers: { "access-control-allow-origin": "*" },
  });
});
try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", {
      name: "private-room (private channel)",
      exact: true,
    })
    .click();
  await expect(page.locator(".message")).toHaveCount(300);
  await expect(page.locator(".compose-audience")).toContainText(
    "Private channel · members only",
  );
  const topicRow = page
    .locator(".topic-row")
    .filter({ has: page.locator(".topic-name", { hasText: /^Thread$/ }) });
  const topic = topicRow.locator("button.topic");
  await expect(topic).toHaveAccessibleName("Thread, 3 unread");
  await expect(topicRow.locator(".thread-badge")).toHaveText("3");
  await topic.click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Thread options: Thread", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Open thread", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(topic).toBeFocused();
  await topic.press("Shift+F10");
  await page.getByRole("menuitem", { name: "15 minutes", exact: true }).click();
  await expect(topicRow).toHaveClass(/muted/);
  await expect(topic).toHaveAccessibleName("Thread, muted");
  await expect(topicRow.locator(".thread-badge")).toHaveCount(0);
  const storedMute = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("zoomerlip.thread.v1."),
    );
    return key
      ? { key, value: JSON.parse(localStorage.getItem(key)), now: Date.now() }
      : null;
  });
  expect(storedMute).not.toBeNull();
  expect(storedMute.value.until - storedMute.now).toBeGreaterThan(14 * 60000);
  expect(storedMute.value.until - storedMute.now).toBeLessThanOrEqual(
    15 * 60000,
  );
  const activeHeader = await page
    .locator(".conversation-header strong")
    .textContent();
  await page.evaluate((key) => {
    const value = JSON.stringify({ until: Date.now() + 350 });
    localStorage.setItem(key, value);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        newValue: value,
        storageArea: localStorage,
      }),
    );
  }, storedMute.key);
  await expect(topicRow).not.toHaveClass(/muted/);
  await expect(topic).toHaveAccessibleName("Thread, 3 unread");
  await expect(topicRow.locator(".thread-badge")).toHaveText("3");
  await expect(page.locator(".conversation-header strong")).toHaveText(
    activeHeader,
  );
  console.log(
    "PASS thread-menu focus, timed mute persistence and automatic expiry restoring unread badges.",
  );
  const initial = await page.evaluate(() => window.dateFormats);
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .pressSequentially("Typing should not format history again.");
  expect(await page.evaluate(() => window.dateFormats)).toBe(initial);
  const last = page.getByRole("article").last();
  await last.focus();
  await expect(last).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("article").nth(298)).toBeFocused();
  await page.keyboard.press("End");
  await expect(last).toBeFocused();
  await last.getByRole("button", { name: "Add reaction" }).click();
  await expect(
    page.getByRole("button", { name: "thumbs up", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    last.getByRole("button", { name: "Add reaction" }),
  ).toBeFocused();
  await last.getByRole("button", { name: "Edit message", exact: true }).click();
  await page.getByRole("button", { name: "Save edit", exact: true }).click();
  expect(edits).toBe(0);
  await last.getByRole("button", { name: "Edit message", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit message", exact: true })
    .fill("Changed");
  await page
    .getByRole("textbox", { name: "Edit message", exact: true })
    .press("Enter");
  await expect.poll(() => edits).toBe(1);
  await page
    .getByRole("button", { name: "Add organization", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Add organization" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Add organization" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add organization", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Thread topic", exact: true })
    .fill("Late send topic");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Late send fixture");
  const acknowledged = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/messages",
  );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByRole("button", { name: "Direct messages", exact: true })
    .last()
    .click();
  await acknowledged;
  await expect(page.locator(".conversation-header strong")).toHaveText(
    "Direct messages",
  );
  const owner = page.locator('[data-member-id="1"]');
  await owner.focus();
  await page.locator(".member-window").evaluate((el) => {
    el.scrollTop = 30000;
  });
  await expect(owner).toBeFocused();
  expect(await page.locator(".member").count()).toBeLessThan(40);
  await expect(owner.locator("small")).toContainText("Owner");
  await page.keyboard.press("End");
  await expect(page.locator('[data-member-id="1000"]')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle channels" }).click();
  await expect(
    page.getByRole("button", { name: "Close channels", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Toggle channels" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Toggle channels" }).click();
  await page
    .getByRole("navigation", { name: "Organizations" })
    .getByRole("button", { name: "Direct messages" })
    .click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/mobile-open/);
  const contrastFailures = await page.evaluate(() => {
    const root = document.documentElement,
      failures = [];
    const luminance = (hex) => {
      if (hex.length === 4)
        hex = "#" + [...hex.slice(1)].map((c) => c + c).join("");
      const c = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    };
    for (const theme of ["graphite", "midnight", "light"])
      for (const accent of ["mint", "lime", "violet", "coral"]) {
        root.dataset.theme = theme;
        root.dataset.accent = accent;
        const css = getComputedStyle(root);
        for (const [fg, bg] of [
          ["secondary", "surface"],
          ["muted", "raised"],
          ["accent", "field"],
        ]) {
          const a = luminance(css.getPropertyValue("--" + fg).trim()),
            b = luminance(css.getPropertyValue("--" + bg).trim()),
            ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          if (ratio < 4.5) failures.push({ theme, accent, fg, bg, ratio });
        }
      }
    return failures;
  });
  expect(contrastFailures).toEqual([]);
  expect(errors).toEqual([]);
  expect(blocked).toEqual([]);
  console.log(
    "PASS 300-row typing isolation; keyboard message/emoji/member navigation; focus retention; no-op edits; audience labels; native dialog and mobile drawer dismissal; late sends; 12 theme/accent contrast combinations; thread menu keyboard/right-click, timed mute expiry and unread restoration; no external requests.",
  );
} finally {
  await browser.close();
}
