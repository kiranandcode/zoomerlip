// Synthetic browser safety checks. Outbound requests are denied except the local app;
// both Zulip origins below are intercepted and never contacted.
import { chromium, expect } from "@playwright/test";
const app = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4173";
if (!["127.0.0.1", "localhost"].includes(new URL(app).hostname))
  throw new Error("Local client only.");
const origin = "https://fixture.zulip.test",
  second = "https://second.zulip.test";
const account = {
  id: `${origin}|1`,
  url: origin,
  email: "fixture@test.invalid",
  apiKey: "synthetic-key",
  name: "Fixture",
  userId: 1,
};
const people = [
  {
    user_id: 1,
    full_name: "Fixture Owner",
    email: account.email,
    is_active: true,
    is_bot: false,
    role: 100,
  },
  {
    user_id: 2,
    full_name: "Muted Person",
    email: "muted@test.invalid",
    is_active: true,
    is_bot: false,
    role: 400,
  },
  {
    user_id: 3,
    full_name: "Visible Person",
    email: "visible@test.invalid",
    is_active: true,
    is_bot: false,
    role: 400,
  },
];
const messages = people.map((person, i) => ({
  id: i + 1,
  sender_id: person.user_id,
  sender_full_name: person.full_name,
  avatar_url: null,
  timestamp: 1700000000 + i * 600,
  content: `<p>${["Private fixture secret", "Muted fixture content", "Visible fixture content"][i]}</p>`,
  type: "stream",
  stream_id: 11,
  subject: "Private topic",
  display_recipient: "secret-room",
  reactions: [],
  flags: [],
}));
const browser = await chromium.launch({ channel: "chrome", headless: true });
async function fixture() {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    pending = [],
    blocked = [],
    errors = [];
  let queue = 0,
    event = 0,
    identityStarted = false,
    identityFinished = false,
    releaseIdentity,
    delayIdentity = false;
  await context.addInitScript((a) => {
    if (!["127.0.0.1", "localhost"].includes(location.hostname)) return;
    if (!sessionStorage.getItem("fixture-loaded")) {
      localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify([a]));
      sessionStorage.setItem("fixture-loaded", "true");
    }
  }, account);
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  await context.route("**/*", async (route) => {
    const request = route.request(),
      u = new URL(request.url()),
      path = u.pathname;
    if (u.origin === new URL(app).origin) return route.continue();
    if (![origin, second].includes(u.origin)) {
      blocked.push(request.url());
      return route.abort();
    }
    let data = { result: "success", msg: "" };
    if (path.endsWith("/register"))
      data = {
        ...data,
        queue_id: `q${++queue}`,
        last_event_id: event,
        realm_name: u.origin === origin ? "Fixture" : "Second",
        subscriptions:
          u.origin === origin
            ? [
                {
                  stream_id: 11,
                  name: "secret-room",
                  description: "Private",
                  invite_only: true,
                },
              ]
            : [],
        realm_users: people,
        muted_users: [{ id: 2 }],
        recent_private_conversations: [],
        unread_msgs: { streams: [] },
        zulip_feature_level: 500,
      };
    else if (path.endsWith("/events")) {
      if (request.method() === "DELETE") return route.fulfill({ json: data });
      if (u.searchParams.get("dont_block") === "true")
        return route.fulfill({ json: { ...data, events: [] } });
      pending.push(route);
      return;
    } else if (path.endsWith("/topics"))
      data = { ...data, topics: [{ name: "Private topic", max_id: 3 }] };
    else if (path.endsWith("/messages")) {
      const narrow = JSON.parse(u.searchParams.get("narrow") || "[]"),
        sender = narrow.find((n) => n.operator === "sender")?.operand;
      data = {
        ...data,
        messages: narrow.some(
          (n) => n.operator === "stream" || n.operator === "sender",
        )
          ? messages.filter((m) => !sender || m.sender_id === sender)
          : [],
        found_oldest: true,
      };
    } else if (path.endsWith("/users/me")) {
      identityStarted = true;
      if (delayIdentity)
        await new Promise((resolve) => {
          releaseIdentity = resolve;
        });
      data = {
        ...data,
        user_id: u.origin === second ? 4 : 1,
        full_name: "Synthetic identity",
      };
    }
    try {
      await route.fulfill({
        json: data,
        headers: { "access-control-allow-origin": "*" },
      });
    } catch {
      /* Aborted authentication must never be committed by the app. */
    }
    if (path.endsWith("/users/me")) identityFinished = true;
  });
  async function page() {
    const p = await context.newPage();
    await p.goto(app);
    await expect(p.getByText("Live", { exact: true })).toBeVisible();
    return p;
  }
  async function emit(events, status = 200) {
    await expect.poll(() => pending.length).toBeGreaterThan(0);
    const r = pending.shift();
    await r.fulfill({
      status,
      json:
        status === 200
          ? {
              result: "success",
              events: events.map((e) => ({ ...e, id: ++event })),
            }
          : {
              result: "error",
              msg: "Synthetic unauthorized",
              code: "UNAUTHORIZED",
            },
    });
  }
  return {
    context,
    page,
    emit,
    blocked,
    errors,
    pending,
    delayIdentity: () => {
      delayIdentity = true;
    },
    identityStarted: () => identityStarted,
    identityFinished: () => identityFinished,
    releaseIdentity: () => releaseIdentity?.(),
  };
}
try {
  const f = await fixture();
  try {
    const p = await f.page();
    await p
      .getByRole("button", {
        name: "secret-room (private channel)",
        exact: true,
      })
      .click();
    await expect(
      p.getByText("Private fixture secret", { exact: true }),
    ).toBeVisible();
    await expect(
      p.getByText("Visible fixture content", { exact: true }),
    ).toBeVisible();
    await expect(
      p.getByText("Muted fixture content", { exact: true }),
    ).toHaveCount(0);
    await expect(p.getByText("Muted Person", { exact: true })).toHaveCount(0);
    await f.emit([
      { type: "muted_users", muted_users: [{ id: 2 }, { id: 3 }] },
    ]);
    await expect(
      p.getByText("Visible fixture content", { exact: true }),
    ).toHaveCount(0);
    await expect(p.getByText("Visible Person", { exact: true })).toHaveCount(0);
    await p.getByRole("button", { name: "My posts", exact: true }).click();
    await expect(
      p.getByText("Private fixture secret", { exact: true }),
    ).toBeVisible();
    await p
      .getByRole("button", {
        name: "secret-room (private channel)",
        exact: true,
      })
      .click();
    await p
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Private unsent draft");
    await f.emit([
      {
        type: "subscription",
        op: "remove",
        subscriptions: [{ stream_id: 11 }],
      },
    ]);
    await expect(p.locator(".conversation-header strong")).toHaveText(
      "Direct messages",
    );
    await expect(
      p.getByText("Private fixture secret", { exact: true }),
    ).toHaveCount(0);
    await expect(
      p.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveCount(0);
    await p.getByRole("button", { name: "My posts", exact: true }).click();
    await expect(
      p.getByText("Private fixture secret", { exact: true }),
    ).toHaveCount(0);
    expect(f.blocked).toEqual([]);
    expect(f.errors).toEqual([]);
    console.log(
      "PASS pre-existing/live mutes and private channel revocation purge history, profiles and composer.",
    );
  } finally {
    await f.context.close();
  }
  const g = await fixture();
  try {
    const p = await g.page();
    await p
      .getByRole("button", {
        name: "secret-room (private channel)",
        exact: true,
      })
      .click();
    await expect(
      p.getByText("Private fixture secret", { exact: true }),
    ).toBeVisible();
    await p
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Private draft");
    await g.emit([], 401);
    await expect(p.getByRole("alert")).toContainText("session is locked");
    await expect(
      p.getByText("Private fixture secret", { exact: true }),
    ).toHaveCount(0);
    await expect(
      p.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveCount(0);
    await p.getByRole("button", { name: "My posts", exact: true }).click();
    await expect(
      p.getByText("Private fixture secret", { exact: true }),
    ).toHaveCount(0);
    expect(g.blocked).toEqual([]);
    expect(g.errors).toEqual([]);
    console.log(
      "PASS terminal 401 removes sensitive history and locks composition.",
    );
  } finally {
    await g.context.close();
  }
  const h = await fixture();
  try {
    const p = await h.page();
    h.delayIdentity();
    await p
      .getByRole("button", { name: "Add organization", exact: true })
      .click();
    await p.getByLabel("Organization URL").fill(second);
    await p.getByLabel("Email address").fill("second@test.invalid");
    await p.getByRole("button", { name: "API key / SSO" }).click();
    await p.getByLabel("API key", { exact: true }).fill("synthetic-second-key");
    await p.getByRole("button", { name: "Let’s go" }).click();
    await expect.poll(h.identityStarted).toBe(true);
    await p.keyboard.press("Escape");
    await expect(
      p.getByRole("dialog", { name: "Add organization" }),
    ).toHaveCount(0);
    h.releaseIdentity();
    await expect.poll(h.identityFinished).toBe(true);
    await expect(p.locator(".org-rail .org")).toHaveCount(1);
    const saved = await p.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith("zoomerlip.account.v2."))
        .map((k) => JSON.parse(localStorage.getItem(k))),
    );
    expect(saved.some((a) => a?.url === "https://second.zulip.test")).toBe(
      false,
    );
    expect(h.blocked).toEqual([]);
    expect(h.errors).toEqual([]);
    console.log(
      "PASS closing authentication before a late response cannot persist or activate the account.",
    );
  } finally {
    await h.context.close();
  }
  const j = await fixture();
  try {
    const a = await j.page(),
      b = await j.page();
    a.on("dialog", (dialog) => dialog.accept());
    await a
      .getByRole("button", { name: "Remove organization", exact: true })
      .click();
    await expect(a.getByLabel("Organization URL")).toBeVisible();
    await expect(b.getByLabel("Organization URL")).toBeVisible();
    await b.getByLabel("Organization URL").fill(second);
    await b.getByLabel("Email address").fill("second@test.invalid");
    await b.getByRole("button", { name: "API key / SSO" }).click();
    await b.getByLabel("API key", { exact: true }).fill("synthetic-second-key");
    await b.getByRole("button", { name: "Let’s go" }).click();
    await expect(b.locator(".org-rail .org")).toHaveCount(1);
    await expect(a.locator(".org-rail .org")).toHaveCount(1);
    await expect(
      a.getByRole("button", { name: "Open Second", exact: true }),
    ).toBeVisible();
    await expect(
      b.getByRole("button", { name: "Open Fixture", exact: true }),
    ).toHaveCount(0);
    const persisted = await b.evaluate(() =>
      JSON.parse(
        localStorage.getItem(
          "zoomerlip.account.v2." +
            encodeURIComponent("https://fixture.zulip.test|1"),
        ),
      ),
    );
    expect(persisted).toBeNull();
    expect(j.blocked).toEqual([]);
    expect(j.errors).toEqual([]);
    console.log(
      "PASS cross-tab removal stops both sessions; adding another account cannot restore the removed one.",
    );
  } finally {
    await j.context.close();
  }
} finally {
  await browser.close();
}
