// Synthetic accounts only; all external traffic is intercepted.
import { chromium, expect } from "@playwright/test";
const url = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4185";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Local only");
const accounts = ["first", "second"].map((name) => ({
  id: `https://${name}.zulip.test|1`,
  url: `https://${name}.zulip.test`,
  name,
  userId: 1,
  apiKey: "synthetic",
  email: "reader@test.invalid",
}));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage(),
      errors = [],
      blocked = [];
    const users = ["Reader", "Alice", "Bob", "Charlie"].map((full_name, i) => ({
      user_id: i + 1,
      full_name,
      email: "",
      is_active: true,
      is_bot: false,
    }));
    const dm = (id, ids) => ({
      id,
      type: "private",
      subject: "",
      sender_id: ids[0],
      sender_full_name: users[ids[0] - 1].full_name,
      avatar_url: null,
      timestamp: 1700000000 + id,
      content: `<p>DM ${id}</p>`,
      display_recipient: [1, ...ids].map((id) => ({
        id,
        full_name: users[id - 1].full_name,
        email: "",
      })),
      flags: ["read"],
      reactions: [],
    });
    const messages = [dm(10, [2]), dm(20, [3]), dm(30, [2, 3])];
    await context.addInitScript(
      (a) => localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify(a)),
      accounts,
    );
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        p = u.pathname;
      if (u.origin === new URL(url).origin) return route.continue();
      const a = accounts.find((a) => a.url === u.origin);
      if (!a) {
        blocked.push(req.url());
        return route.abort();
      }
      const data = { result: "success", msg: "" };
      if (p.endsWith("/register"))
        Object.assign(data, {
          queue_id: a.name,
          last_event_id: 0,
          realm_name: a.name,
          zulip_feature_level: 400,
          subscriptions: [{ stream_id: 1, name: "general", description: "" }],
          realm_users: users,
          recent_private_conversations:
            a.name === "first"
              ? [
                  { user_ids: [2], max_message_id: 10 },
                  { user_ids: [3], max_message_id: 20 },
                  { user_ids: [2, 3], max_message_id: 30 },
                ]
              : [],
          unread_msgs: {
            pms:
              a.name === "first"
                ? [{ other_user_id: 2, unread_message_ids: [10] }]
                : [],
          },
        });
      else if (p.endsWith("/events") && req.method() !== "DELETE") {
        await new Promise((r) => setTimeout(r, 100));
        data.events = [];
      } else if (/\/messages\/10$/.test(p)) data.message = messages[0];
      else if (p.endsWith("/messages") && req.method() === "GET") {
        const n = JSON.parse(u.searchParams.get("narrow") || "[]"),
          target = n.find((n) => ["dm", "pm-with"].includes(n.operator));
        let selected = a.name === "first" ? messages : [];
        if (n.some((n) => n.operand === "unread"))
          selected = [{ ...messages[0], flags: [] }];
        else if (target)
          selected = selected.filter(
            (m) =>
              m.display_recipient
                .filter((u) => u.id !== 1)
                .map((u) => u.id)
                .join(",") === [...target.operand].join(","),
          );
        else if (n.some((n) => n.operator === "stream")) selected = [];
        Object.assign(data, {
          messages: selected,
          found_oldest: true,
          found_newest: true,
        });
      } else if (p.endsWith("/topics")) data.topics = [];
      await route.fulfill({
        json: data,
        headers: { "access-control-allow-origin": "*" },
      });
    });
    await page.goto(url);
    const drawer = async () => {
      if (mobile)
        await page
          .getByRole("button", { name: /^Toggle (channels|conversations)$/ })
          .click();
    };
    await drawer();
    await page
      .getByRole("button", { name: "Direct messages", exact: true })
      .click();
    await drawer();
    const side = page.getByRole("navigation", {
      name: "Direct message conversations",
    });
    await expect(
      side.getByRole("button", { name: "Alice", exact: true }),
    ).toBeVisible();
    await expect(
      side.getByRole("button", { name: "Alice, Bob", exact: true }),
    ).toBeVisible();
    await side.getByRole("button", { name: "Alice", exact: true }).click();
    await expect(page.locator(".conversation-header")).toContainText("Alice");
    await drawer();
    await expect(
      side.getByRole("button", { name: "Alice", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await side.getByRole("button", { name: "Bob", exact: true }).click();
    await expect(page.locator(".conversation-header")).toContainText("Bob");
    await page.screenshot({
      path: `/tmp/zoomerlip-dm-${mobile ? "mobile" : "desktop"}.png`,
    });
    await page
      .getByRole("button", { name: "Back to direct messages", exact: true })
      .click();
    await expect(page.locator(".conversation-header")).toContainText(
      "Direct messages",
    );
    await drawer();
    await side.getByRole("button", { name: "Alice, Bob", exact: true }).click();
    await expect(page.locator(".conversation-header")).toContainText(
      "Alice, Bob",
    );
    await drawer();
    await page
      .getByRole("textbox", { name: "Find or start a conversation" })
      .fill("Charlie");
    await side.getByRole("button", { name: "Charlie", exact: true }).click();
    await drawer();
    await expect(
      side.getByRole("button", { name: "Charlie", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      side.getByRole("button", { name: "Bob", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Find unread messages, 1 unread",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("group", { name: "Unread conversations" }),
    ).toBeVisible();
    await expect(page.locator(".search-filters")).toHaveCount(0);
    await page.getByRole("button", { name: "DMs", exact: true }).click();
    await page
      .getByRole("button", { name: "Open conversation", exact: true })
      .click();
    await expect(page.locator(".conversation-header")).toContainText("Alice");
    await expect(
      page.getByRole("button", {
        name: "Back to direct messages",
        exact: true,
      }),
    ).toBeVisible();
    await drawer();
    await page.getByRole("button", { name: /^Open first/ }).click();
    await expect(
      page.getByRole("button", { name: "general", exact: true }),
    ).toBeVisible();
    await expect(side).toHaveCount(0);
    await page.getByRole("button", { name: /^Open second/ }).click();
    await page
      .getByRole("button", { name: "Direct messages", exact: true })
      .click();
    await drawer();
    await expect(
      side.getByRole("button", { name: "Alice", exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(blocked).toEqual([]);
    console.log(
      `${mobile ? "Mobile" : "Desktop"} DM navigation, groups, back, unread inbox and org isolation passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
