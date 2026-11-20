import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const url = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4191";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Local only");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  await mkdir("test-results/demo", { recursive: true });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 960 },
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: "reduce",
    });
    const external = [],
      errors = [];
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin !== new URL(url).origin) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.getByRole("link", { name: "Try demo" }).click();
    await expect(
      page.getByRole("region", { name: "Demo preview" }),
    ).toBeVisible();
    await expect(page.locator(".message").first()).toContainText(
      "fictional workspace",
    );
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.fill("hello from my demo");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const sent = page
      .locator(".message")
      .filter({ hasText: "hello from my demo" });
    await expect(sent).toBeVisible();
    const reaction = page.locator(".reactions button").first();
    await expect(reaction).toBeVisible();
    await reaction.click();
    await expect(reaction).toHaveClass(/mine/);
    await reaction.click();
    await expect(reaction).not.toHaveClass(/mine/);
    const drawer = async () => {
      if (mobile)
        await page
          .getByRole("button", { name: /^Toggle (channels|conversations)$/ })
          .click();
    };
    await drawer();
    await page
      .getByRole("button", { name: "type-theory", exact: true })
      .click();
    await expect(
      page.locator(".message").filter({ hasText: "Reversing a list twice" }),
    ).toBeVisible();
    await drawer();
    await page
      .getByRole("button", { name: "Direct messages", exact: true })
      .click();
    await drawer();
    await page
      .getByRole("navigation", { name: "Direct message conversations" })
      .getByRole("button", { name: /Maya Patel/ })
      .click();
    await expect(
      page.locator(".message").filter({ hasText: "proof clinic notes" }),
    ).toBeVisible();
    await message.fill("a local DM");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.locator(".message").filter({ hasText: "a local DM" }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/demo/${mobile ? "mobile" : "desktop"}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.reload();
    await expect(page.locator(".message").first()).toContainText(
      "fictional workspace",
    );
    await expect(
      page.getByText("hello from my demo", { exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith("zoomerlip.account"),
        ),
      ),
    ).toEqual([]);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
    await page.getByRole("button", { name: "Exit demo", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await context.close();
  }
  // A shareable demo must not open or overwrite an existing signed-in account.
  const context = await browser.newContext();
  const existing = JSON.stringify([
    {
      url: "https://saved.zulip.test",
      id: "https://saved.zulip.test|9",
      userId: 9,
      email: "saved@example.invalid",
      apiKey: "synthetic-saved-key",
      name: "Saved",
    },
  ]);
  await context.addInitScript(
    (value) => localStorage.setItem("zoomerlip.accounts.v1", value),
    existing,
  );
  const external = [];
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === new URL(url).origin)
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(`${url}/#demo`);
  await expect(page.locator(".message").first()).toContainText(
    "fictional workspace",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("zoomerlip.accounts.v1")),
  ).toBe(existing);
  expect(external).toEqual([]);
  await context.close();
  console.log(
    "PASS demo: desktop/mobile entry, local sends, reactions, channel/DM navigation, reload reset, saved-account isolation, zero external traffic.",
  );
} finally {
  await browser.close();
}
