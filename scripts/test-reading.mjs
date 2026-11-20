// Local UI only. Every organisation request is intercepted.
import { chromium, expect } from "@playwright/test";
const url = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4185";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Local client only");
const account = {
  id: "https://reading.zulip.test|1",
  url: "https://reading.zulip.test",
  email: "reader@test.invalid",
  apiKey: "synthetic",
  userId: 1,
  name: "Reading",
};
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
    const writes = [],
      events = [],
      errors = [],
      blocked = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const messages = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      sender_id: 2,
      sender_full_name: "Fixture Writer",
      avatar_url: null,
      timestamp: 1700000000 + i * 400,
      content: `<p>Unread message ${i + 1}</p>`,
      type: "stream",
      stream_id: 1,
      subject: "Thread",
      display_recipient: "general",
      reactions: [],
      flags: [],
    }));
    let nextEvent = 1;
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
      let data = { result: "success", msg: "" };
      if (path.endsWith("/register"))
        Object.assign(data, {
          queue_id: "reading",
          last_event_id: 0,
          realm_name: "Reading",
          zulip_feature_level: 177,
          subscriptions: [
            { stream_id: 1, name: "general", description: "Fixture" },
          ],
          realm_users: [
            { user_id: 1, full_name: "Reader", is_active: true, role: 400 },
            {
              user_id: 2,
              full_name: "Fixture Writer",
              is_active: true,
              role: 400,
            },
          ],
          unread_msgs: {
            streams: [
              {
                stream_id: 1,
                topic: "Thread",
                unread_message_ids: messages.map((m) => m.id),
              },
            ],
          },
        });
      else if (path.endsWith("/events")) {
        if (req.method() === "DELETE") return route.fulfill({ json: data });
        await new Promise((r) => setTimeout(r, 100));
        data.events = events.filter(
          (e) => e.id > Number(u.searchParams.get("last_event_id")),
        );
      } else if (path.endsWith("/topics"))
        data.topics = [{ name: "Thread", max_id: messages.at(-1).id }];
      else if (path.endsWith("/messages/flags")) {
        const body = new URLSearchParams(req.postData());
        const ids = JSON.parse(body.get("messages"));
        expect(body.get("flag")).toBe("read");
        expect(body.get("op")).toBe("add");
        writes.push(ids);
        for (const message of messages)
          if (ids.includes(message.id)) message.flags = ["read"];
        events.push({
          id: nextEvent++,
          type: "update_message_flags",
          messages: ids,
          flag: "read",
          op: "add",
        });
        data.messages = ids;
      } else if (path.endsWith("/messages"))
        Object.assign(data, {
          messages: JSON.parse(u.searchParams.get("narrow") || "[]").some(
            (n) => n.operator === "stream",
          )
            ? messages
            : [],
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
    await page.getByRole("button", { name: "general", exact: true }).click();
    await expect(page.locator("article[data-message-id]")).toHaveCount(60);
    await expect.poll(() => writes.flat().includes(60)).toBe(true);
    expect(writes.flat().includes(1)).toBe(false);
    const initialCount = new Set(writes.flat()).size;
    expect(initialCount).toBeGreaterThan(0);
    expect(initialCount).toBeLessThan(60);
    const badge = page.locator(".topic-row .thread-badge").first();
    await expect(badge).toHaveText(String(60 - initialCount));
    if (mobile) {
      await page
        .getByRole("button", { name: "Toggle channels", exact: true })
        .click();
      const before = writes.length;
      const message = {
        ...messages.at(-1),
        id: 61,
        content: "<p>Arrived behind drawer</p>",
        flags: [],
      };
      messages.push(message);
      events.push({ id: nextEvent++, type: "message", message, flags: [] });
      await expect(page.locator('article[data-message-id="61"]')).toHaveCount(
        1,
      );
      await page.waitForTimeout(900);
      expect(writes.length).toBe(before);
      await page
        .getByRole("button", { name: "Close channels", exact: true })
        .click();
      await expect.poll(() => writes.flat().includes(61)).toBe(true);
    }
    await page.locator(".message-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect.poll(() => writes.flat().includes(1)).toBe(true);
    expect(errors).toEqual([]);
    expect(blocked).toEqual([]);
    await context.close();
    console.log(
      `PASS visible read acknowledgements and live unread badges (${mobile ? "mobile with drawer" : "desktop"}); all requests intercepted.`,
    );
  }
} finally {
  await browser.close();
}
