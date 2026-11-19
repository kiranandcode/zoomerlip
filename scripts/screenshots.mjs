// Public screenshots use an isolated browser and synthetic data only.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const url = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4173";
const origin = new URL(url).origin;
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Local preview only.");
const accounts = ["Proof Club", "Open Source Lab"].map((name, i) => ({
  id: `https://demo${i}.zulip.test|1`,
  url: `https://demo${i}.zulip.test`,
  email: "alex@example.invalid",
  apiKey: "synthetic-demo-key",
  name,
  userId: 1,
}));
const names = [
  "Alex Chen",
  "Maya Patel",
  "Noor Hassan",
  "Kai Moreno",
  "Sam Rivera",
  "Lin Park",
  "Robin Ellis",
  "Jules Martin",
];
const users = names.map((full_name, i) => ({
  user_id: i + 1,
  full_name,
  email: `demo${i}@example.invalid`,
  is_active: true,
  is_bot: false,
  role: i === 0 ? 100 : 400,
}));
const channels = ["general", "type-theory", "projects", "reading-group"].map(
  (name, i) => ({
    stream_id: i + 1,
    name,
    description: [
      "Announcements and everyday conversations",
      "Proofs, questions and small discoveries",
      "What are you working on?",
      "Papers worth reading",
    ][i],
    invite_only: false,
    color: "#8992e8",
  }),
);
const posts = [
  [2, "<p>I put together a small example for tomorrow’s proof clinic.</p>"],
  [
    2,
    "<p>The statement is simple: reversing a list twice gives you the original list.</p><pre><code>theorem reverse_reverse (xs : List α) :\n    xs.reverse.reverse = xs := by\n  induction xs with\n  | nil =&gt; rfl\n  | cons x xs ih =&gt; simp [ih]</code></pre>",
  ],
  [
    3,
    "<p>The induction hypothesis is doing the interesting work here. Could we try the same proof without <code>simp</code>?</p>",
  ],
  [
    4,
    "<p>Yes. We would need a lemma about reversing an appended list first.</p>",
  ],
  [
    1,
    "<p>That would make a good pair of exercises. One with the library lemmas, one from the definitions.</p>",
  ],
  [2, "<p>Added both versions to the notes.</p>"],
  [
    5,
    "<p>I can walk through the append lemma. It is a nice example of choosing the right induction variable.</p>",
  ],
  [3, "<p>Perfect. Let’s leave time for questions at the end.</p>"],
  [1, "<p>Thursday at 16:00 works for me. See you there!</p>"],
];
const messages = posts.map(([sender, content], i) => ({
  id: 101 + i,
  sender_id: sender,
  sender_full_name: names[sender - 1],
  avatar_url: null,
  timestamp: 1795091400 + i * 150,
  content,
  rendered_content: content,
  type: "stream",
  stream_id: 2,
  subject: "Induction on lists",
  display_recipient: "type-theory",
  reactions:
    i === 7
      ? [
          {
            emoji_name: "thumbs_up",
            emoji_code: "1f44d",
            reaction_type: "unicode_emoji",
            user_id: 2,
          },
          {
            emoji_name: "thumbs_up",
            emoji_code: "1f44d",
            reaction_type: "unicode_emoji",
            user_id: 4,
          },
        ]
      : [],
}));
const browser = await chromium.launch({ channel: "chrome", headless: true });
async function setup(context, signedIn) {
  if (signedIn)
    await context.addInitScript(
      (a) => localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify(a)),
      accounts,
    );
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === origin) return route.continue();
    const index = accounts.findIndex((a) => a.url === u.origin);
    if (index < 0) return route.abort();
    const path = u.pathname;
    let data = { result: "success", msg: "" };
    if (path.endsWith("/register"))
      data = {
        ...data,
        queue_id: `demo-${index}`,
        last_event_id: 0,
        realm_name: accounts[index].name,
        subscriptions: channels,
        realm_users: users,
        unread_msgs: {
          streams: [
            {
              stream_id: 3,
              topic: "Weekend projects",
              unread_message_ids: [211, 212, 213],
            },
          ],
        },
      };
    else if (path.endsWith("/events")) return;
    else if (path.endsWith("/topics"))
      data = {
        ...data,
        topics: [
          { name: "Induction on lists", max_id: 109 },
          { name: "Proof clinic", max_id: 98 },
          { name: "Reading recommendations", max_id: 81 },
        ],
      };
    else if (path.endsWith("/messages"))
      data = {
        ...data,
        messages: JSON.parse(u.searchParams.get("narrow") || "[]").some(
          (n) => n.operator === "stream",
        )
          ? messages
          : [],
        found_oldest: true,
        found_newest: true,
      };
    await route.fulfill({
      json: data,
      headers: { "access-control-allow-origin": "*" },
    });
  });
}
try {
  await mkdir("docs/screenshots", { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    timezoneId: "UTC",
    colorScheme: "dark",
  });
  await setup(context, true);
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole("button", { name: "type-theory", exact: true }).click();
  await page
    .getByRole("button", { name: "Induction on lists", exact: true })
    .click();
  await expect(page.locator(".message")).toHaveCount(messages.length);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "docs/screenshots/channels.png" });
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/appearance.png" });
  await context.close();
  const landing = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  await setup(landing, false);
  const welcome = await landing.newPage();
  await welcome.goto(url);
  await welcome.evaluate(() => document.fonts.ready);
  await welcome.screenshot({ path: "docs/screenshots/login.png" });
  await landing.close();
  console.log("Saved synthetic workspace, appearance and login screenshots.");
} finally {
  await browser.close();
}
