// Intercepted local browser fixture; never touches real organisations.
import { chromium, expect } from "@playwright/test";
const url = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4185";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Local client only");
const account = {
  id: "https://preferences.zulip.test|1",
  url: "https://preferences.zulip.test",
  email: "reader@test.invalid",
  apiKey: "synthetic",
  userId: 1,
  name: "Preferences",
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 320, height: 740 }
        : { width: 1440, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const channels = [1, 2].map((id) => ({
      stream_id: id,
      name: id === 1 ? "general" : "random",
      description: "Fixture",
      is_muted: false,
    }));
    const topics = [
      { stream_id: 1, topic_name: "Followed", visibility_policy: 3 },
      { stream_id: 1, topic_name: "Muted", visibility_policy: 1 },
      { stream_id: 2, topic_name: "Unmuted", visibility_policy: 2 },
    ];
    const events = [],
      writes = [],
      errors = [],
      blocked = [];
    let seq = 1;
    page.on("pageerror", (e) => errors.push(e.message));
    await context.addInitScript(
      (a) => localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify([a])),
      account,
    );
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        path = u.pathname;
      if (u.origin === new URL(url).origin) return route.continue();
      if (u.origin !== account.url) {
        blocked.push(req.url());
        return route.abort();
      }
      const body = new URLSearchParams(req.postData() || "");
      let data = { result: "success", msg: "" };
      if (path.endsWith("/register")) {
        expect(
          JSON.parse(body.get("client_capabilities"))
            .notification_settings_null,
        ).toBe(true);
        if (body.get("event_types") === "[]")
          Object.assign(data, { queue_id: "temporary", user_topics: topics });
        else
          Object.assign(data, {
            queue_id: "session",
            last_event_id: 0,
            realm_name: "Preferences",
            zulip_feature_level: 400,
            subscriptions: channels,
            user_topics: topics,
            realm_users: [
              { user_id: 1, full_name: "Reader", is_active: true, role: 400 },
            ],
            unread_msgs: { streams: [] },
          });
      } else if (path.endsWith("/events")) {
        if (req.method() !== "DELETE") {
          await new Promise((r) => setTimeout(r, 100));
          data.events = events.filter(
            (e) => e.id > Number(u.searchParams.get("last_event_id")),
          );
        }
      } else if (path.endsWith("/subscriptions/properties")) {
        const changes = JSON.parse(body.get("subscription_data"));
        writes.push({ type: "mute", changes });
        for (const change of changes) {
          expect(change.property).toBe("is_muted");
          channels.find((c) => c.stream_id === change.stream_id).is_muted =
            change.value;
          events.push({
            id: seq++,
            type: "subscription",
            op: "update",
            ...change,
          });
        }
      } else if (path.endsWith("/subscriptions")) {
        expect(req.method()).toBe("GET");
        data.subscriptions = channels;
      } else if (path.endsWith("/user_topics")) {
        const topic = topics.find(
          (t) =>
            t.stream_id === Number(body.get("stream_id")) &&
            t.topic_name === body.get("topic"),
        );
        expect(topic.visibility_policy).toBe(3);
        topic.visibility_policy = Number(body.get("visibility_policy"));
        writes.push({ type: "unfollow", topic: topic.topic_name });
        events.push({ id: seq++, type: "user_topic", ...topic });
      } else if (path.endsWith("/streams")) data.streams = channels;
      else if (/\/streams\/\d+\/members$/.test(path)) data.subscribers = [1];
      else if (path.endsWith("/topics")) data.topics = [];
      else if (path.endsWith("/messages"))
        Object.assign(data, {
          messages: [],
          found_oldest: true,
          found_newest: true,
        });
      else if (path.endsWith("/user_groups")) data.user_groups = [];
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
    const channel = page.getByRole("button", { name: "general", exact: true });
    if (mobile)
      await page
        .getByRole("button", { name: "Channel options: general", exact: true })
        .click();
    else await channel.click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Channel options: general" });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(mobile ? 320 : 1440);
    await menu
      .getByRole("menuitem", { name: "Mute channel", exact: true })
      .click();
    await expect(page.locator(".channel-row.muted")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Channel options: general", exact: true })
      .click();
    await menu
      .getByRole("menuitem", { name: "Unmute channel", exact: true })
      .click();
    await expect(page.locator(".channel-row.muted")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Channel options: general", exact: true })
      .click();
    await menu.getByRole("menuitem", { name: "Channel settings" }).click();
    await expect(
      page.getByRole("heading", { name: "general", exact: true }),
    ).toBeVisible();
    await page
      .getByText("Channel and topic preferences", { exact: true })
      .click();
    const bulkMute = page.getByRole("button", {
      name: "Mute all joined channels",
    });
    const count = writes.length;
    page.once("dialog", (dialog) => dialog.dismiss());
    await bulkMute.click();
    await expect(bulkMute).toBeEnabled();
    expect(writes.length).toBe(count);
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("2 currently unmuted joined channels");
      return dialog.accept();
    });
    await bulkMute.click();
    await expect(page.getByLabel("Preference results")).toContainText(
      "2 confirmed",
    );
    expect(channels.every((c) => c.is_muted)).toBe(true);
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("1 followed topics");
      return dialog.accept();
    });
    await page
      .getByRole("button", { name: "Unfollow all followed topics" })
      .click();
    await expect(page.getByLabel("Preference results")).toContainText(
      "1 confirmed",
    );
    expect(topics.map((t) => t.visibility_policy)).toEqual([0, 1, 2]);
    expect(errors).toEqual([]);
    expect(blocked).toEqual([]);
    await context.close();
    console.log(
      `PASS channel menus, mute/unmute, cancellation, bulk mute and unfollow (${mobile ? "320px touch" : "desktop right-click"}); all writes intercepted.`,
    );
  }
} finally {
  await browser.close();
}
