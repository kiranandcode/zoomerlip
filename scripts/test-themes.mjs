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
  await page.getByRole("button", { name: "Save custom theme" }).click();
  await other.getByRole("button", { name: "Save custom theme" }).click();
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
  await page.screenshot({ path: "test-results/custom-themes.png" });
  expect(errors).toEqual([]);
  console.log(
    "PASS create, preview, persistence, export/import, invalid CSS rejection, light capture, inactive deletion and two-tab theme preservation.",
  );
} finally {
  await browser.close();
}
