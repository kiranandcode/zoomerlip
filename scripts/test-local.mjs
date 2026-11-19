import { chromium, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const account = JSON.parse(await readFile("local/test-account.json", "utf8"));
if (account.url !== "http://localhost:8080")
  throw new Error("Tests may only target the local Zulip server.");
const auth = (email, key) =>
  `Basic ${Buffer.from(`${email}:${key}`).toString("base64")}`;
async function api(path, params, method = "POST", as = account) {
  const body = new URLSearchParams(
    Object.entries(params || {}).map(([k, v]) => [
      k,
      typeof v === "object" ? JSON.stringify(v) : String(v),
    ]),
  );
  const response = await fetch(
    `${account.url}/api/v1${path}${method === "GET" ? "?" + body : ""}`,
    {
      method,
      headers: { Authorization: auth(as.email, as.apiKey) },
      ...(method === "GET" ? {} : { body }),
    },
  );
  const data = await response.json();
  if (!response.ok || data.result === "error") throw new Error(data.msg);
  return data;
}
const appUrl = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost"].includes(new URL(appUrl).hostname))
  throw new Error("App tests must use a loopback URL.");
const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL || "chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
let registrations = 0,
  historyRequests = 0,
  topicRequests = 0;
page.on("request", (request) => {
  const path = new URL(request.url()).pathname;
  if (request.method() === "GET" && path === "/api/v1/messages")
    historyRequests++;
  if (path.endsWith("/topics")) topicRequests++;
});
page.on("response", (response) => {
  if (response.url().endsWith("/api/v1/register") && response.status() === 200)
    registrations++;
});
let expireOnce = true;
await page.route("**/api/v1/events?**", async (route) => {
  if (expireOnce) {
    expireOnce = false;
    await api(
      "/events",
      { queue_id: new URL(route.request().url()).searchParams.get("queue_id") },
      "DELETE",
    );
  }
  await route.continue();
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("Browser:", msg.text());
});
await mkdir("test-results", { recursive: true });
try {
  await page.goto(appUrl);
  await page.getByLabel("Organization URL").fill(account.url);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Let’s go" }).click();
  await expect(
    page.getByRole("navigation", { name: "Organizations" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Live", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await expect.poll(() => registrations).toBeGreaterThanOrEqual(2);
  console.log(
    "PASS password login, live registration and expired-queue recovery",
  );
  await page.getByRole("button", { name: "general", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "↳ show & tell", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page
    .getByRole("button", { name: "↳ show & tell", exact: true })
    .click();
  await expect(
    page
      .getByText("Love this. Rough drafts count too.", { exact: true })
      .first(),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/channel.png" });
  const historyBeforeEvents = historyRequests,
    topicsBeforeEvents = topicRequests;
  const marker = `Browser smoke ${Date.now()}`;
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill(marker);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText(marker, { exact: true })).toBeVisible({
    timeout: 15000,
  });
  console.log("PASS channel/topic history and sending");
  const incoming = `Live incoming ${Date.now()}`;
  await api(
    "/messages",
    { type: "stream", to: "general", topic: "show & tell", content: incoming },
    "POST",
    account.alex,
  );
  const incomingArticle = page
    .getByRole("article")
    .filter({ hasText: incoming });
  await expect(incomingArticle).toBeVisible({ timeout: 15000 });
  await incomingArticle.hover();
  await incomingArticle.getByRole("button", { name: "Add reaction" }).click();
  await page.getByRole("button", { name: "rocket", exact: true }).click();
  await expect(
    incomingArticle.getByRole("button", { name: "rocket: 1 reactions" }),
  ).toBeVisible({ timeout: 10000 });
  await incomingArticle
    .getByRole("button", { name: "rocket: 1 reactions" })
    .click();
  await expect(
    incomingArticle.getByRole("button", { name: "rocket: 1 reactions" }),
  ).toHaveCount(0, { timeout: 10000 });
  console.log("PASS live messages and reaction add/remove");
  const own = page.getByRole("article").filter({ hasText: marker });
  await own.hover();
  await own.getByRole("button", { name: "Edit message" }).click();
  await page
    .getByRole("textbox", { name: "Edit message" })
    .fill(`${marker} edited`);
  await page.getByRole("button", { name: "Save edit" }).click();
  await expect(page.getByText(`${marker} edited`, { exact: true })).toBeVisible(
    { timeout: 10000 },
  );
  expect(historyRequests).toBe(historyBeforeEvents);
  expect(topicRequests).toBe(topicsBeforeEvents);
  console.log(
    "PASS editing; message/reaction/edit events caused zero history or topic requests",
  );
  // Uploaded text files are opened with a fresh temporary URL on every click.
  const form = new FormData();
  form.set(
    "file",
    new Blob(["Zoomerlip attachment smoke"], { type: "text/plain" }),
    "smoke.txt",
  );
  const uploaded = await (
    await fetch(`${account.url}/api/v1/user_uploads`, {
      method: "POST",
      headers: { Authorization: auth(account.email, account.apiKey) },
      body: form,
    })
  ).json();
  if (uploaded.result !== "success") throw new Error(JSON.stringify(uploaded));
  await api("/messages", {
    type: "stream",
    to: "general",
    topic: "show & tell",
    content: `[test attachment](${uploaded.uri || uploaded.url})`,
  });
  const link = page.getByRole("link", { name: "test attachment" }).last();
  await expect(link).toBeVisible({ timeout: 10000 });
  const popupPromise = context.waitForEvent("page");
  await link.click();
  const popup = await popupPromise;
  await expect(popup.locator("body")).toContainText(
    "Zoomerlip attachment smoke",
    { timeout: 15000 },
  );
  await popup.close();
  console.log("PASS private attachment temporary URL");
  const imageForm = new FormData();
  imageForm.set(
    "file",
    new Blob(
      [
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=",
          "base64",
        ),
      ],
      { type: "image/png" },
    ),
    "test-pixel.png",
  );
  const imageUpload = await (
    await fetch(`${account.url}/api/v1/user_uploads`, {
      method: "POST",
      headers: { Authorization: auth(account.email, account.apiKey) },
      body: imageForm,
    })
  ).json();
  await api("/messages", {
    type: "stream",
    to: "general",
    topic: "show & tell",
    content: `[test-pixel.png](${imageUpload.uri || imageUpload.url})`,
  });
  const image = page.locator(".message-content img").last();
  await expect(image).toBeVisible({ timeout: 15000 });
  await expect
    .poll(() => image.evaluate((el) => el.complete && el.naturalWidth > 0), {
      timeout: 15000,
    })
    .toBe(true);
  console.log("PASS private image thumbnails");
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const newTopic = `new thread ${Date.now()}`;
  await page.getByRole("textbox", { name: "Thread topic" }).fill(newTopic);
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("First message in the new thread");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByRole("heading", { name: newTopic, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("First message in the new thread", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  console.log("PASS new thread creation and navigation");
  await page
    .getByRole("button", { name: "Direct messages", exact: true })
    .first()
    .click();
  await page.locator(".dm-card").filter({ hasText: "Alex Rivera" }).click();
  const dm = `DM smoke ${Date.now()}`;
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(dm);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(dm, { exact: true })).toBeVisible({
    timeout: 10000,
  });
  console.log("PASS DM history and sending");
  // Warm navigation preserves drafts and uses cached history.
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("An unsent draft");
  await page.getByRole("button", { name: "general", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  const beforeRevisit = historyRequests;
  await page
    .getByRole("button", { name: "Direct messages", exact: true })
    .first()
    .click();
  await page.locator(".dm-card").filter({ hasText: "Alex Rivera" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("An unsent draft");
  await expect(page.getByText(dm, { exact: true })).toBeVisible();
  expect(historyRequests).toBe(beforeRevisit);
  console.log("PASS warm navigation without a history request; draft restored");
  await page.getByRole("button", { name: "My posts", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Morgan Chen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`${marker} edited`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(incoming, { exact: true })).toHaveCount(0);
  await expect(page.getByText(dm, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/profile-graphite.png" });
  await page.getByRole("button", { name: "Include DMs", exact: true }).click();
  await expect(page.getByText(dm, { exact: true })).toBeVisible();
  const dmCard = page.getByRole("article").filter({ hasText: dm });
  await dmCard.getByRole("button", { name: "Open conversation" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("An unsent draft");
  console.log(
    "PASS own profile, author filtering, channel/DM scope and opening conversations",
  );
  await page.locator(".member").filter({ hasText: "Alex Rivera" }).click();
  await expect(
    page.getByRole("heading", { name: "Alex Rivera", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(incoming, { exact: true })).toBeVisible();
  await expect(page.getByText(`${marker} edited`, { exact: true })).toHaveCount(
    0,
  );
  console.log("PASS member profiles");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "light theme", exact: true }).click();
  await page
    .getByRole("button", { name: "violet accent", exact: true })
    .click();
  await page.getByRole("button", { name: "compact", exact: true }).click();
  await page.getByLabel("Message text size").fill("17");
  await page.getByLabel("Smooth transitions").uncheck();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  await page.screenshot({ path: "test-results/appearance-light.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
  await page.screenshot({ path: "test-results/profile-light.png" });
  await page.reload();
  await expect(page.getByText("Live", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  expect(
    await page
      .locator("html")
      .evaluate((el) => el.style.getPropertyValue("--message-size")),
  ).toBe("17px");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page
    .getByRole("button", { name: "midnight theme", exact: true })
    .click();
  await page.getByRole("button", { name: "Close appearance" }).click();
  await page.screenshot({ path: "test-results/midnight.png" });
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "Reset appearance" }).click();
  await page.getByRole("button", { name: "Close appearance" }).click();
  console.log(
    "PASS saved themes, accents, density, font size, reduced motion and session restore",
  );
  // A second local identity exercises independent credentials and queues.
  await page.getByRole("button", { name: "Add organization" }).click();
  await page.getByLabel("Organization URL").fill(account.url);
  await page.getByLabel("Email address").fill(account.alex.email);
  await page.getByRole("button", { name: "API key / SSO" }).click();
  await page.getByLabel("API key", { exact: true }).fill(account.alex.apiKey);
  await page.getByRole("button", { name: "Let’s go" }).click();
  await expect(page.locator(".org-rail .org")).toHaveCount(2, {
    timeout: 15000,
  });
  await expect(page.getByText("Live", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.locator(".org-rail .org").first().click();
  await expect(page.locator(".profile")).toContainText("Morgan Chen");
  console.log("PASS API-key login, concurrent sessions and switching");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle channels" }).click();
  await page.getByRole("button", { name: "general", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await expect.poll(() => page.locator(".message").count()).toBeGreaterThan(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: "test-results/mobile.png" });
  await page.getByRole("button", { name: "Toggle channels" }).click();
  await page.getByRole("button", { name: "My posts", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Morgan Chen", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator(".activity-card").count())
    .toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/profile-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Toggle channels" }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.screenshot({ path: "test-results/appearance-mobile.png" });
  await page.getByRole("button", { name: "Close appearance" }).click();
  expect(errors).toEqual([]);
  console.log("PASS mobile layout; no runtime errors");
} catch (e) {
  await page.screenshot({ path: "test-results/failure.png" });
  console.error((await page.locator("body").innerText()).slice(-5000));
  throw e;
} finally {
  await browser.close();
}
