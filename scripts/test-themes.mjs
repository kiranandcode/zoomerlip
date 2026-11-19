import { chromium, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const url = process.env.ZOOMERLIP_TEST_URL || "http://127.0.0.1:4173";
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Local client only.");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1000, height: 1000 },
});
const page = await context.newPage(),
  other = await context.newPage();
const errors = [];
for (const p of [page, other]) p.on("pageerror", (e) => errors.push(e.message));
await mkdir("test-results", { recursive: true });
try {
  for (const [p, name] of [
    [page, "Fixture A"],
    [other, "Fixture B"],
  ]) {
    await p.goto(url);
    await p.getByRole("button", { name: "Appearance", exact: true }).click();
    await p.getByRole("button", { name: "Create theme", exact: true }).click();
    await p.getByLabel("Theme name", { exact: true }).fill(name);
  }
  await page.getByLabel("Accent hex", { exact: true }).fill("#e0a050");
  await Promise.all([
    page.getByRole("button", { name: "Save custom theme" }).click(),
    other.getByRole("button", { name: "Save custom theme" }).click(),
  ]);
  await expect(
    page.getByRole("button", { name: "Fixture B", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fixture A", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fixture A", exact: true }).click();
  await expect(page.locator("html")).toHaveCSS("--accent", "#e0a050");
  await page.getByRole("button", { name: "Close appearance" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveCSS("--accent", "#e0a050");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Fixture A", exact: true })
    .click();
  const download = await dl;
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(Object.keys(exported).sort()).toEqual([
    "base",
    "colours",
    "name",
    "version",
  ]);
  await page.getByRole("button", { name: "light theme", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete Fixture A", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Create theme" }).click();
  await expect(page.getByLabel("Messages hex")).toHaveValue("#ffffff");
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await page.getByLabel("Import theme file").setInputFiles({
    name: "theme.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByLabel("Theme name", { exact: true })).toHaveValue(
    "Fixture A",
  );
  await page.getByRole("button", { name: "Save custom theme" }).click();
  await page.getByLabel("Import theme file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        ...exported,
        colours: {
          ...exported.colours,
          accent: "url(https://example.invalid)",
        },
      }),
    ),
  });
  await expect(page.getByRole("alert")).toContainText("hex colour");
  // A superseded file read must not replace a newer palette or its errors.
  await page.evaluate(() => {
    window.__themeFileText = File.prototype.text;
    File.prototype.text = function () {
      const result = window.__themeFileText.call(this);
      return this.name === "slow.json"
        ? new Promise((resolve) => {
            window.__finishSlowTheme = () => result.then(resolve);
          })
        : result;
    };
  });
  await page.getByLabel("Import theme file").setInputFiles({
    name: "slow.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ ...exported, name: "Obsolete import" }),
    ),
  });
  await page.getByLabel("Import theme file").setInputFiles({
    name: "new.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...exported, name: "Newest import" })),
  });
  await expect(page.getByLabel("Theme name", { exact: true })).toHaveValue(
    "Newest import",
  );
  await page.evaluate(async () => {
    await window.__finishSlowTheme();
    await Promise.resolve();
    File.prototype.text = window.__themeFileText;
    delete window.__themeFileText;
    delete window.__finishSlowTheme;
  });
  await expect(page.getByLabel("Theme name", { exact: true })).toHaveValue(
    "Newest import",
  );
  await page
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click();
  // A closed dialog retains the in-memory draft; closing is not cancellation.
  await page.getByRole("button", { name: "Create theme", exact: true }).click();
  await page
    .getByLabel("Theme name", { exact: true })
    .fill("Unfinished palette");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.getByLabel("Theme name", { exact: true })).toHaveValue(
    "Unfinished palette",
  );
  await page
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click();
  // Deletion can be undone, and an old editor cannot silently recreate it.
  await page
    .getByRole("button", { name: "Delete Fixture B", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit Fixture B", exact: true })
    .click();
  await page
    .getByLabel("Theme name", { exact: true })
    .fill("Edited after deletion");
  await other
    .getByRole("button", { name: "Delete Fixture B", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save custom theme", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("changed or was deleted");
  await expect(
    page.getByRole("button", { name: "Fixture B", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save as copy", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edited after deletion", exact: true }),
  ).toBeVisible();
  // A hostile/unreadable palette cannot paint over its recovery controls.
  const black = {
    ...exported,
    name: "Black fixture",
    colours: Object.fromEntries(
      Object.keys(exported.colours).map((k) => [k, "#000000"]),
    ),
  };
  await page.getByLabel("Import theme file").setInputFiles({
    name: "black.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(black)),
  });
  await expect(page.locator("html")).toHaveCSS("--surface", "#000000");
  const readable = await page.locator("dialog").evaluate((el) => {
    const style = getComputedStyle(el);
    return style.color !== style.backgroundColor;
  });
  expect(readable).toBe(true);
  await expect(page.locator(".theme-contrast")).toContainText(
    "Main text / input fields: 1.00:1",
  );
  await page
    .getByRole("button", { name: "Save custom theme", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Confirm the low contrast choice",
  );
  await page.getByLabel("Save despite low contrast", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save custom theme", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close appearance", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset appearance", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  // Failed preference writes remain effective for this page session.
  await page.evaluate(() => {
    window.__originalThemeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "zoomerlip.appearance.v1")
        throw new DOMException("quota", "QuotaExceededError");
      return window.__originalThemeSetItem.call(this, key, value);
    };
  });
  await page
    .getByRole("button", { name: "midnight theme", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("not saved");
  await page
    .getByRole("button", { name: "Close appearance", exact: true })
    .click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "midnight theme", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Reset appearance", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("not saved");
  await page.evaluate(() => {
    Storage.prototype.setItem = window.__originalThemeSetItem;
    delete window.__originalThemeSetItem;
  });
  await page.screenshot({ path: "test-results/custom-themes.png" });
  expect(errors).toEqual([]);
  console.log(
    "PASS themes: import/export, safe preview/recovery, session-only writes, retained drafts, deletion undo, conflicting editors, copy recovery and two-tab preservation.",
  );
} finally {
  await browser.close();
}
