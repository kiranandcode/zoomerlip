// Local-only synthetic member fixture. No users are created on the server.
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const account = JSON.parse(await readFile("local/test-account.json", "utf8"));
if (account.url !== "http://localhost:8080")
  throw new Error("Local Zulip only.");
const appUrl = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost"].includes(new URL(appUrl).hostname))
  throw new Error("Local client only.");
const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL || "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let fulfilledAt = 0;
await page.route("**/api/v1/register", async (route) => {
  const response = await route.fetch();
  const body = await response.json();
  if (body.result !== "success") throw new Error("Local registration failed.");
  body.realm_users.push(
    ...Array.from({ length: 10000 }, (_, i) => ({
      user_id: 100000 + i,
      full_name: `Fixture member ${String(i).padStart(5, "0")}`,
      email: `fixture${i}@zoomerlip.test`,
      is_bot: false,
      is_active: true,
      avatar_url: null,
    })),
  );
  fulfilledAt = Date.now();
  await route.fulfill({ response, json: body });
});
await mkdir("test-results", { recursive: true });
try {
  await page.goto(appUrl);
  await page.getByLabel("Organization URL").fill(account.url);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByRole("button", { name: "API key / SSO" }).click();
  await page.getByLabel("API key", { exact: true }).fill(account.apiKey);
  await page.getByRole("button", { name: "Let’s go" }).click();
  await expect(page.locator(".members header")).toContainText("10004", {
    timeout: 15000,
  });
  const visibleAt = Date.now(),
    rows = await page.locator(".member").count();
  expect(rows).toBeLessThan(35);
  await page.locator(".member-window").evaluate((el) => {
    el.scrollTop = 240000;
  });
  await expect(
    page.locator(".member").filter({ hasText: "Fixture member 05000" }),
  ).toBeVisible();
  expect(await page.locator(".member").count()).toBeLessThan(40);
  await page.getByLabel("Find channels or people").fill("Fixture member 09999");
  await expect(page.locator(".person")).toHaveCount(1);
  await expect(page.locator(".person")).toContainText("Fixture member 09999");
  await page.screenshot({ path: "test-results/large-org.png" });
  expect(errors).toEqual([]);
  console.log(
    `PASS 10,004-member fixture: ${rows} initial member rows; ${visibleAt - fulfilledAt} ms from fixture response to visible member count. Scrolling and search passed.`,
  );
} finally {
  await browser.close();
}
