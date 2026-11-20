// Local fixture only. Every org request is intercepted.
import { chromium, expect } from "@playwright/test";
const url = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4185";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Local client only");
const account = {
  id: "https://unreads.zulip.test|1",
  url: "https://unreads.zulip.test",
  email: "reader@test.invalid",
  apiKey: "synthetic",
  userId: 1,
  name: "Unreads",
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
    const page = await context.newPage(),
      events = [],
      errors = [],
      blocked = [],
      writes = [];
    let unreadSearches = 0;
    const message = (id, subject, stream_id = 1) => ({
      id,
      subject,
      stream_id,
      type: "stream",
      sender_id: 2,
      sender_full_name: "Writer",
      avatar_url: null,
      timestamp: 1700000000,
      content: `<p>Message ${id}</p>`,
      display_recipient: stream_id === 1 ? "general" : "quiet",
      reactions: [],
      flags: [],
    });
    const messages = [
      message(1, "Old Topic"),
      message(2, "Old Topic"),
      message(3, "Exception", 2),
      {
        ...message(4, ""),
        stream_id: undefined,
        type: "private",
        display_recipient: [
          { id: 1, full_name: "Reader" },
          { id: 2, full_name: "Writer" },
        ],
      },
      message(5, "Muted"),
      message(6, "Local"),
    ];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.addInitScript((a) => {
      localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify([a]));
      localStorage.setItem(
        `zoomerlip.thread.v1.${encodeURIComponent(a.id)}.${encodeURIComponent(JSON.stringify([1, "local"]))}`,
        JSON.stringify({ until: null }),
      );
    }, account);
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        p = u.pathname;
      if (u.origin === new URL(url).origin) return route.continue();
      if (u.origin !== account.url) {
        blocked.push(req.url());
        return route.abort();
      }
      if (
        !["GET", "DELETE"].includes(req.method()) &&
        !p.endsWith("/register") &&
        !p.endsWith("/users/me/presence")
      )
        writes.push(p);
      const data = { result: "success", msg: "" };
      if (p.endsWith("/register"))
        Object.assign(data, {
          queue_id: "q",
          last_event_id: 0,
          realm_name: "Unreads",
          zulip_feature_level: 400,
          subscriptions: [
            { stream_id: 1, name: "general", description: "" },
            { stream_id: 2, name: "quiet", description: "", is_muted: true },
          ],
          realm_users: [
            { user_id: 1, full_name: "Reader", is_active: true },
            { user_id: 2, full_name: "Writer", is_active: true },
          ],
          user_topics: [
            { stream_id: 1, topic_name: "Muted", visibility_policy: 1 },
            { stream_id: 2, topic_name: "Exception", visibility_policy: 2 },
          ],
          unread_msgs: {
            streams: [
              { stream_id: 1, topic: "Old Topic", unread_message_ids: [1, 2] },
              { stream_id: 2, topic: "Exception", unread_message_ids: [3] },
              { stream_id: 1, topic: "Muted", unread_message_ids: [5] },
              { stream_id: 1, topic: "Local", unread_message_ids: [6] },
            ],
            pms: [{ other_user_id: 2, unread_message_ids: [4] }],
          },
        });
      else if (p.endsWith("/events") && req.method() !== "DELETE") {
        await new Promise((r) => setTimeout(r, 100));
        data.events = events.filter(
          (e) => e.id > Number(u.searchParams.get("last_event_id")),
        );
      } else if (p.endsWith("/topics"))
        data.topics = [
          ...Array.from({ length: 30 }, (_, i) => ({
            name: `Read ${i}`,
            max_id: 100 - i,
          })),
          { name: "Old Topic", max_id: 2 },
        ];
      else if (p.endsWith("/messages")) {
        const narrow = JSON.parse(u.searchParams.get("narrow") || "[]");
        const unread = narrow.some(
          (n) => n.operator === "is" && n.operand === "unread",
        );
        if (unread) unreadSearches++;
        Object.assign(data, {
          messages: unread ? messages : [],
          found_oldest: true,
          found_newest: true,
        });
      }
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
    const general = page.getByRole("button", { name: "general", exact: true });
    await expect(general).toHaveAttribute(
      "aria-description",
      "2 unread messages",
    );
    await expect(general.locator(".thread-badge")).toHaveText("2");
    await expect(page.locator(".channel-row.unread")).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "quiet", exact: true }),
    ).toHaveAttribute("aria-description", "1 unread messages");
    await expect(
      page.getByRole("button", { name: "Find unread messages, 4 unread" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Expand general", exact: true })
      .click();
    await expect(page.locator(".topics .topic-row").first()).toContainText(
      "Old Topic",
    );
    await expect(
      page.getByRole("button", { name: "Old Topic, 2 unread", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Find unread messages, 4 unread" })
      .click();
    await expect(page.locator(".search-result")).toHaveCount(4);
    await expect(page.locator(".search-results")).toContainText("Message 4");
    await expect(page.locator(".search-results")).not.toContainText(
      "Message 5",
    );
    await expect(page.locator(".search-results")).not.toContainText(
      "Message 6",
    );
    expect(unreadSearches).toBe(1);
    if (mobile)
      await page
        .getByRole("button", { name: "Toggle channels", exact: true })
        .click();
    events.push({
      id: 1,
      type: "update_message_flags",
      op: "add",
      flag: "read",
      messages: [1, 2],
    });
    await expect(general.locator(".thread-badge")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Find unread messages, 2 unread" }),
    ).toBeVisible();
    events.push({
      id: 2,
      type: "update_message_flags",
      op: "add",
      flag: "read",
      all: true,
    });
    await expect(page.locator(".channel-row.unread")).toHaveCount(0);
    await expect(page.locator(".unread-shortcut")).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(blocked).toEqual([]);
    expect(errors).toEqual([]);
    console.log(`${mobile ? "Mobile" : "Desktop"} unread navigation passed`);
    await context.close();
  }
} finally {
  await browser.close();
}
