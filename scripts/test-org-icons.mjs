// All org and CDN requests are intercepted; no real accounts are used.
import { chromium, expect } from "@playwright/test";
const url = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4185";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Local client only");
const accounts = ["Alpha", "Beta"].map((name, i) => ({
  id: `https://${name.toLowerCase()}.zulip.test|1`,
  url: `https://${name.toLowerCase()}.zulip.test`,
  email: "reader@test.invalid",
  apiKey: "synthetic",
  userId: 1,
  name,
}));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const events = [],
      errors = [],
      unexpected = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.addInitScript(
      (a) => localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify(a)),
      accounts,
    );
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      if (u.origin === new URL(url).origin) return route.continue();
      const account = accounts.find((a) => a.url === u.origin);
      if (
        req.resourceType() === "image" &&
        (account || u.origin === "https://cdn.zulip.test")
      ) {
        expect(req.headers().authorization).toBeUndefined();
        expect(req.headers().referer).toBeUndefined();
        if (u.pathname === "/broken.png")
          return route.fulfill({ status: 404, body: "" });
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#827bff"/></svg>',
        });
      }
      if (!account) {
        unexpected.push(req.url());
        return route.abort();
      }
      const data = { result: "success", msg: "" };
      if (u.pathname.endsWith("/register")) {
        const body = new URLSearchParams(req.postData());
        expect(JSON.parse(body.get("fetch_event_types"))).toContain("realm");
        expect(JSON.parse(body.get("event_types"))).toContain("realm");
        Object.assign(data, {
          queue_id: account.name,
          last_event_id: 0,
          realm_name: account.name,
          realm_icon_url:
            account.name === "Alpha"
              ? "/icon.png"
              : "https://cdn.zulip.test/beta.png",
          zulip_feature_level: 400,
          subscriptions: [],
          realm_users: [],
          unread_msgs: {
            pms: [{ other_user_id: 2, unread_message_ids: [99] }],
          },
        });
      } else if (u.pathname.endsWith("/events") && req.method() !== "DELETE") {
        await new Promise((r) => setTimeout(r, 100));
        data.events =
          account.name === "Alpha"
            ? events.filter(
                (e) => e.id > Number(u.searchParams.get("last_event_id")),
              )
            : [];
      } else if (u.pathname.endsWith("/messages"))
        Object.assign(data, {
          messages: [],
          found_oldest: true,
          found_newest: true,
        });
      else if (u.pathname.endsWith("/subscriptions")) data.subscriptions = [];
      await route.fulfill({
        json: data,
        headers: { "access-control-allow-origin": "*" },
      });
    });
    await page.goto(url);
    if (mobile)
      await page
        .getByRole("button", { name: "Toggle channels", exact: true })
        .click();
    const alpha = page.getByRole("button", { name: /^Open Alpha/ });
    const beta = page.getByRole("button", { name: /^Open Beta/ });
    await expect(alpha.locator("img")).toHaveAttribute(
      "src",
      `${accounts[0].url}/icon.png`,
    );
    await expect(beta.locator("img")).toHaveAttribute(
      "src",
      "https://cdn.zulip.test/beta.png",
    );
    await expect
      .poll(() => alpha.locator("img").evaluate((img) => img.naturalWidth))
      .toBe(64);
    await expect(beta.locator(".badge")).toBeVisible();
    const buttonBox = await alpha.boundingBox();
    const imageBox = await alpha.locator("img").boundingBox();
    expect(imageBox.width).toBeCloseTo(buttonBox.width, 0);
    expect(imageBox.height).toBeCloseTo(buttonBox.height, 0);
    await page.screenshot({
      path: `/tmp/zoomerlip-org-icons-${mobile ? "mobile" : "desktop"}.png`,
    });
    await beta.click();
    await expect(beta).toHaveAttribute("aria-pressed", "true");
    events.push({
      id: 1,
      type: "realm",
      op: "update_dict",
      property: "icon",
      data: { icon_url: "/broken.png" },
    });
    await expect(alpha.locator("img")).toHaveCount(0);
    await expect(alpha).toContainText("A");
    events.push({
      id: 2,
      type: "realm",
      op: "update_dict",
      property: "icon",
      data: { icon_url: "/new.png" },
    });
    await expect(alpha.locator("img")).toHaveAttribute(
      "src",
      `${accounts[0].url}/new.png`,
    );
    await expect
      .poll(() => alpha.locator("img").evaluate((img) => img.naturalWidth))
      .toBe(64);
    events.push({
      id: 3,
      type: "realm",
      op: "update_dict",
      property: "icon",
      data: { icon_url: "javascript:alert(1)" },
    });
    await expect(alpha.locator("img")).toHaveCount(0);
    await expect(beta.locator("img")).toHaveAttribute(
      "src",
      "https://cdn.zulip.test/beta.png",
    );
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    console.log(
      `${mobile ? "Mobile" : "Desktop"}: org icons, switching, badge, live updates, failure recovery, unsafe URL passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
