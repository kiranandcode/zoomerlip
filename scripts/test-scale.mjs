// Intercepted 10,000-member fixture. No credentials or Zulip server are used.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const account = {
  url: "https://scale-fixture.zulip.test",
  email: "fixture@test.invalid",
  apiKey: "synthetic-scale-key",
};
const appUrl = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4173";
if (!["127.0.0.1", "localhost"].includes(new URL(appUrl).hostname))
  throw new Error("Local client only.");
const users = Array.from({ length: 10000 }, (_, i) => ({
  user_id: 100000 + i,
  full_name: `Fixture member ${String(i).padStart(5, "0")}`,
  email: i === 0 ? account.email : `fixture${i}@test.invalid`,
  is_bot: false,
  is_active: true,
  avatar_url: null,
  role: i === 0 ? 100 : 400,
}));
const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL || "chrome",
  headless: true,
  args: ["--disable-gpu"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: "block",
});
context.setDefaultTimeout(15000);
const page = await context.newPage();
const errors = [],
  blocked = [];
page.on("pageerror", (e) => errors.push(e.message));
let fulfilledAt = 0;
await context.route("**/*", async (route) => {
  const request = route.request(),
    u = new URL(request.url());
  if (u.origin === new URL(appUrl).origin && !u.pathname.startsWith("/api/"))
    return route.continue();
  if (u.origin !== account.url) {
    blocked.push(request.url());
    return route.abort();
  }
  let data = { result: "success", msg: "" };
  if (u.pathname === "/api/v1/users/me") data = { ...data, ...users[0] };
  else if (u.pathname === "/api/v1/register") {
    data = {
      ...data,
      queue_id: "scale-fixture-queue",
      last_event_id: 0,
      realm_name: "Scale fixture",
      realm_users: users,
      subscriptions: [],
      muted_users: [],
      recent_private_conversations: [],
      unread_msgs: { streams: [] },
      zulip_feature_level: 500,
    };
    fulfilledAt = Date.now();
  } else if (u.pathname === "/api/v1/events") {
    if (
      request.method() === "GET" &&
      u.searchParams.get("dont_block") !== "true"
    )
      return; // Keep the synthetic long poll pending until browser teardown.
    data = { ...data, events: [] };
  } else if (u.pathname === "/api/v1/messages")
    data = { ...data, messages: [], found_oldest: true, found_newest: true };
  else if (u.pathname === "/api/v1/user_groups" && request.method() === "GET")
    data = { ...data, user_groups: [] };
  else {
    blocked.push(request.url());
    return route.abort();
  }
  await route.fulfill({
    json: data,
    headers: { "access-control-allow-origin": "*" },
  });
});
await mkdir("test-results", { recursive: true });
try {
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Organization URL").fill(account.url);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByRole("button", { name: "API key / SSO" }).click();
  await page.getByLabel("API key", { exact: true }).fill(account.apiKey);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".members header")).toContainText("10000", {
    timeout: 15000,
  });
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  const visibleAt = Date.now(),
    rows = await page.locator(".member").count();
  expect(rows).toBeGreaterThan(0);
  expect(rows).toBeLessThan(35);
  await page.locator(".member-window").evaluate((el) => {
    el.scrollTop = 240000;
  });
  await expect(
    page.locator(".member").filter({ hasText: "Fixture member 05000" }),
  ).toBeVisible();
  const scrolledRows = await page.locator(".member").count();
  expect(scrolledRows).toBeLessThan(40);
  await page.getByLabel("Find channels or people").fill("Fixture member 09999");
  await expect(page.locator(".person")).toHaveCount(1);
  await expect(page.locator(".person")).toContainText("Fixture member 09999");
  await page.screenshot({ path: "test-results/large-org.png" });
  expect(errors).toEqual([]);
  expect(blocked).toEqual([]);
  console.log(
    `PASS 10,000-member intercepted fixture: ${rows} initial rows, ${scrolledRows} scrolled rows; ${visibleAt - fulfilledAt} ms from fixture response to visible member count. Scrolling and exact search passed. No external requests or page errors.`,
  );
} finally {
  await browser.close();
}
