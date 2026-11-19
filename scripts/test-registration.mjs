// Enforce Zulip's required capability field and expire the first event queue.
// All organisation requests are intercepted; no real credentials or server writes.
import { chromium, expect } from "@playwright/test";
const url = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4173";
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Local fixtures only.");
const account = {
  id: "https://registration-fixture.invalid|1",
  url: "https://registration-fixture.invalid",
  email: "fixture@test.invalid",
  apiKey: "synthetic",
  name: "Registration fixture",
  userId: 1,
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
const rejected = [],
  external = [],
  errors = [],
  capabilities = [];
let registrations = 0,
  replacementPolled = false;
await context.addInitScript(
  (a) => localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify([a])),
  account,
);
await context.route("**/*", async (route) => {
  const request = route.request(),
    u = new URL(request.url());
  if (u.origin === new URL(url).origin) return route.continue();
  if (u.origin !== account.url) {
    external.push(u.origin);
    return route.abort();
  }
  const reply = (data, status = 200) =>
    route.fulfill({ status, json: { result: "success", msg: "", ...data } });
  if (u.pathname === "/api/v1/register") {
    const body = new URLSearchParams(request.postData() || "");
    const value = JSON.parse(body.get("client_capabilities") || "{}");
    // ClientCapabilities.notification_settings_null is required by upstream's
    // TypedDict (zerver/lib/events.py), even though the object itself is optional.
    if (typeof value.notification_settings_null !== "boolean") {
      rejected.push("notification_settings_null");
      return reply(
        {
          result: "error",
          msg: 'client_capabilities["notification_settings_null"] field is missing: Field required',
          code: "BAD_REQUEST",
        },
        400,
      );
    }
    capabilities.push(value);
    registrations++;
    return reply({
      queue_id: `queue-${registrations}`,
      last_event_id: 0,
      realm_name: account.name,
      zulip_feature_level: 500,
      subscriptions: [],
      unread_msgs: { streams: [], pms: [], huddles: [], mentions: [] },
      realm_users: [
        {
          user_id: 1,
          full_name: "Fixture User",
          email: account.email,
          role: 400,
          is_active: true,
          is_bot: false,
        },
      ],
      user_settings: { presence_enabled: false },
    });
  }
  if (u.pathname === "/api/v1/events") {
    if (u.searchParams.get("queue_id") === "queue-1")
      return reply(
        {
          result: "error",
          code: "BAD_EVENT_QUEUE_ID",
          msg: "Fixture queue expired",
        },
        400,
      );
    replacementPolled = true;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return reply({ events: [] }).catch(() => {});
  }
  if (u.pathname === "/api/v1/user_groups") return reply({ user_groups: [] });
  if (u.pathname === "/api/v1/messages")
    return reply({ messages: [], found_oldest: true, found_newest: true });
  return reply({});
});
try {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await expect.poll(() => registrations, { timeout: 10000 }).toBe(2);
  await expect.poll(() => replacementPolled).toBe(true);
  await expect(page.locator(".connection-error")).toHaveCount(0);
  expect(capabilities).toHaveLength(2);
  for (const value of capabilities)
    expect(value.notification_settings_null).toBe(true);
  expect(rejected).toEqual([]);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  console.log(
    "PASS strict capability validation, expired-queue re-registration and resumed polling; no real organisation traffic.",
  );
} finally {
  await context.close();
  await browser.close();
}
