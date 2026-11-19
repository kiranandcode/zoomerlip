// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  applyCustomTheme,
  captureTheme,
  clearCustomTheme,
  colourKeys,
  parseTheme,
  readThemes,
  themeJSON,
  writeThemes,
} from "../src/customThemes";
import {
  applyPreferences,
  defaults,
  readPreferences,
  savePreferences,
} from "../src/appearance";
const theme = {
  id: "test-theme",
  name: "Test palette",
  base: "dark" as const,
  colours: Object.fromEntries(
    colourKeys.map((key) => [key, key === "text" ? "#ffffff" : "#224466"]),
  ) as Record<(typeof colourKeys)[number], string>,
};
beforeEach(() =>
  vi.stubGlobal(
    "localStorage",
    new JSDOM("", { url: "https://zoomerlip.test" }).window.localStorage,
  ),
);
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  clearCustomTheme();
  vi.unstubAllGlobals();
});
it("round-trips only theme data and restores the selected palette", () => {
  writeThemes([theme]);
  savePreferences({ ...defaults, theme: "custom", customId: theme.id });
  expect(readThemes()).toEqual([theme]);
  applyPreferences(readPreferences());
  expect(document.documentElement.style.getPropertyValue("--surface")).toBe(
    "#224466",
  );
  const exported = JSON.parse(themeJSON(theme));
  expect(exported.id).toBeUndefined();
  expect(parseTheme(exported).name).toBe(theme.name);
  applyPreferences(defaults);
  expect(document.documentElement.style.getPropertyValue("--surface")).toBe("");
});
it.each([
  "url(https://evil.invalid/track)",
  "red; background:url(x)",
  "#fff",
  "<script>",
  "#12345678",
])("rejects CSS or non-hex input: %s", (value) => {
  expect(() =>
    parseTheme({
      ...theme,
      version: 1,
      colours: { ...theme.colours, accent: value },
    }),
  ).toThrow();
});
it("drops unrelated keys and corrupted saved themes", () => {
  expect(
    parseTheme({ ...theme, version: 1, apiKey: "never-export", css: "body{}" }),
  ).toEqual({ name: theme.name, base: theme.base, colours: theme.colours });
  localStorage.setItem(
    "zoomerlip.themes.v1",
    JSON.stringify([null, { ...theme, colours: { accent: "red" } }, theme]),
  );
  expect(readThemes()).toEqual([theme]);
});
it("reports storage failures instead of claiming the theme was saved", () => {
  vi.spyOn(Object.getPrototypeOf(localStorage), "setItem").mockImplementation(
    () => {
      throw new Error("quota");
    },
  );
  expect(() => writeThemes([theme])).toThrow("not saved");
});
it("captures only palette values from the visible theme", () => {
  applyCustomTheme(theme);
  expect(captureTheme().colours).toEqual(theme.colours);
});

it("uses black or white button ink with at least 4.5:1 contrast", async () => {
  const { accentInk, contrast } = await import("../src/customThemes");
  for (let n = 0; n < 256; n++) {
    const hex = "#" + n.toString(16).padStart(2, "0").repeat(3);
    expect(contrast(hex, accentInk(hex))).toBeGreaterThanOrEqual(4.5);
  }
});
it("reports functional contrast failures outside the message pane", async () => {
  const { themeContrast } = await import("../src/customThemes");
  const palette = {
    ...theme,
    colours: {
      ...theme.colours,
      surface: "#000000",
      secondary: "#ffffff",
      field: "#ffffff",
      text: "#ffffff",
    },
  };
  const checks = themeContrast(palette);
  expect(checks.find((c) => c.label === "Message text / messages")!.ratio).toBe(
    21,
  );
  expect(
    checks.find((c) => c.label === "Main text / input fields")!.ratio,
  ).toBe(1);
});
it("keeps failed writes in session memory until a real external update", async () => {
  const { preferenceError } = await import("../src/appearance");
  const failure = vi
    .spyOn(Object.getPrototypeOf(localStorage), "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });
  expect(savePreferences({ ...defaults, theme: "midnight" })).toBe(false);
  expect(readPreferences().theme).toBe("midnight");
  expect(preferenceError()).toContain("not saved");
  failure.mockRestore();
  localStorage.setItem(
    "zoomerlip.appearance.v1",
    JSON.stringify({ ...defaults, theme: "light" }),
  );
  window.dispatchEvent(
    new StorageEvent("storage", { key: "zoomerlip.appearance.v1" }),
  );
  expect(readPreferences().theme).toBe("light");
  expect(document.documentElement.dataset.theme).toBe("light");
});
it("normalizes missing custom selections when the library changes", () => {
  writeThemes([theme]);
  savePreferences({ ...defaults, theme: "custom", customId: theme.id });
  writeThemes([]);
  expect(readPreferences().theme).toBe("graphite");
  expect(readPreferences().customId).toBeUndefined();
});
it("rejects duplicate identities and derives a safe export filename", async () => {
  const { themeFilename } = await import("../src/customThemes");
  expect(() => writeThemes([theme, theme])).toThrow("unique");
  expect(themeFilename({ ...theme, name: "../ Nice / palette 😎" })).toBe(
    "nice-palette.json",
  );
});
it("serializes concurrent library writes and detects stale edits/deletes", async () => {
  const { saveTheme, deleteTheme, themeRevision, ThemeConflictError } =
    await import("../src/customThemes");
  let chain = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn((_name: string, fn: () => unknown) => {
        const next = chain.then(fn);
        chain = next.then(
          () => {},
          () => {},
        );
        return next;
      }),
    },
  });
  const second = { ...theme, id: "second", name: "Second" };
  await Promise.all([saveTheme(theme, null), saveTheme(second, null)]);
  expect(readThemes()).toHaveLength(2);
  const revision = themeRevision(theme);
  const updated = { ...theme, name: "Changed elsewhere" };
  await saveTheme(updated, revision);
  await expect(
    saveTheme({ ...theme, name: "Stale edit" }, revision),
  ).rejects.toBeInstanceOf(ThemeConflictError);
  await expect(deleteTheme(theme)).rejects.toBeInstanceOf(ThemeConflictError);
  await deleteTheme(updated);
  await expect(saveTheme(theme, themeRevision(updated))).rejects.toBeInstanceOf(
    ThemeConflictError,
  );
  expect(readThemes().map((t) => t.id)).toEqual(["second"]);
  const copy = await saveTheme({ ...theme, id: "copy" }, null);
  expect(copy.id).toBe("copy");
});
it("refuses unsafe multi-tab mutations if Web Locks is unavailable", async () => {
  const { saveTheme } = await import("../src/customThemes");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  });
  await expect(saveTheme(theme, null)).rejects.toThrow("Web Locks");
  expect(readThemes()).toEqual([]);
});
