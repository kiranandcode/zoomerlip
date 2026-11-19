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
