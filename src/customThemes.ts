export const colourKeys = [
  "rail",
  "sidebar",
  "surface",
  "raised",
  "field",
  "text",
  "secondary",
  "muted",
  "accent",
] as const;
export type ColourKey = (typeof colourKeys)[number];
export type ThemePalette = {
  name: string;
  base: "dark" | "light";
  colours: Record<ColourKey, string>;
};
export type CustomTheme = ThemePalette & { id: string };
export const themeStorageKey = "zoomerlip.themes.v1";
export const maxThemes = 20;
const libraryChanged = "zoomerlip-theme-library";
export function parseTheme(input: unknown): ThemePalette {
  if (!input || typeof input !== "object")
    throw new Error("Invalid theme file.");
  const p = input as Record<string, unknown>;
  if (
    p.version !== 1 ||
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 48 ||
    !["dark", "light"].includes(p.base as string) ||
    !p.colours ||
    typeof p.colours !== "object"
  )
    throw new Error(
      "Use a version 1 Zoomerlip theme with a name, base and colours.",
    );
  const colours = {} as Record<ColourKey, string>;
  for (const key of colourKeys) {
    const value = (p.colours as Record<string, unknown>)[key];
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
      throw new Error(`${key} must be a six-digit hex colour.`);
    colours[key] = value.toLowerCase();
  }
  return { name: p.name.trim(), base: p.base as "dark" | "light", colours };
}
export function readThemes(): CustomTheme[] {
  try {
    const list = JSON.parse(localStorage.getItem(themeStorageKey) || "[]");
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    return list.flatMap((item) => {
      try {
        if (
          seen.size >= maxThemes ||
          typeof item.id !== "string" ||
          !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) ||
          seen.has(item.id)
        )
          return [];
        const valid = { ...parseTheme({ ...item, version: 1 }), id: item.id };
        seen.add(item.id);
        return [valid];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
/** Call only inside a library lock. Exported for fixtures and storage recovery tests. */
export function writeThemes(themes: CustomTheme[]) {
  if (themes.length > maxThemes)
    throw new Error(
      `Keep at most ${maxThemes} custom themes. Delete one first.`,
    );
  const seen = new Set<string>();
  const valid = themes.map((theme) => {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(theme.id) || seen.has(theme.id))
      throw new Error("Theme IDs must be unique.");
    seen.add(theme.id);
    return { ...parseTheme({ ...theme, version: 1 }), id: theme.id };
  });
  try {
    localStorage.setItem(themeStorageKey, JSON.stringify(valid));
  } catch {
    throw new Error(
      "Browser storage is unavailable or full. Your theme was not saved.",
    );
  }
  window.dispatchEvent(new Event(libraryChanged));
}
export function subscribeThemes(listener: () => void) {
  const storage = (e: StorageEvent) => {
    if (e.key === null || e.key === themeStorageKey) listener();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(libraryChanged, listener);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(libraryChanged, listener);
  };
}
export function themeJSON(theme: ThemePalette) {
  return JSON.stringify(
    { version: 1, name: theme.name, base: theme.base, colours: theme.colours },
    null,
    2,
  );
}
export const themeRevision = (theme: CustomTheme) => themeJSON(theme);
export class ThemeConflictError extends Error {}
async function locked<T>(fn: () => T): Promise<T> {
  if (!navigator.locks?.request)
    throw new Error(
      "This browser cannot safely save concurrent theme changes. Export your draft or use a browser with Web Locks support.",
    );
  return navigator.locks.request("zoomerlip-theme-library", fn);
}
/** A null revision creates a new theme. Edits never recreate deleted IDs. */
export async function saveTheme(
  theme: CustomTheme,
  expectedRevision: string | null,
): Promise<CustomTheme> {
  const valid = { ...parseTheme({ ...theme, version: 1 }), id: theme.id };
  return locked(() => {
    const themes = readThemes(),
      existing = themes.find((t) => t.id === valid.id);
    if (
      expectedRevision === null
        ? !!existing
        : !existing || themeRevision(existing) !== expectedRevision
    )
      throw new ThemeConflictError(
        "This theme changed or was deleted in another tab. Save your draft as a copy to keep both versions.",
      );
    writeThemes(
      existing
        ? themes.map((t) => (t.id === valid.id ? valid : t))
        : [...themes, valid],
    );
    return valid;
  });
}
export async function deleteTheme(
  theme: CustomTheme,
): Promise<CustomTheme | null> {
  return locked(() => {
    const themes = readThemes(),
      existing = themes.find((t) => t.id === theme.id);
    if (!existing) return null;
    if (themeRevision(existing) !== themeRevision(theme))
      throw new ThemeConflictError(
        "This theme changed in another tab. Review its latest version before deleting it.",
      );
    writeThemes(themes.filter((t) => t.id !== theme.id));
    return existing;
  });
}
export function themeFilename(theme: ThemePalette) {
  const slug = theme.name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "zoomerlip-theme"}.json`;
}
export function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const rgb = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function accentInk(accent: string) {
  return contrast(accent, "#ffffff") > contrast(accent, "#000000")
    ? "#ffffff"
    : "#000000";
}
export function themeContrast(theme: ThemePalette) {
  const c = theme.colours;
  const pairs: [string, ColourKey, ColourKey][] = [
    ["Main text / messages", "text", "surface"],
    ["Main text / sidebar", "text", "sidebar"],
    ["Main text / input fields", "text", "field"],
    ["Main text / raised surfaces", "text", "raised"],
    ["Message text / messages", "secondary", "surface"],
    ["Message text / sidebar", "secondary", "sidebar"],
    ["Secondary text / sidebar", "muted", "sidebar"],
    ["Secondary text / messages", "muted", "surface"],
    ["Secondary text / input fields", "muted", "field"],
    ["Links / messages", "accent", "surface"],
    ["Accent / sidebar", "accent", "sidebar"],
    ["Accent / input fields", "accent", "field"],
  ];
  return pairs.map(([label, fg, bg]) => ({
    label,
    ratio: contrast(c[fg], c[bg]),
  }));
}
const customVariables = [
  ...colourKeys,
  "accent-ink",
  "accent-soft",
  "border",
  "hover",
];
export function clearCustomTheme() {
  for (const key of customVariables)
    document.documentElement.style.removeProperty(`--${key}`);
  document.documentElement.style.removeProperty("color-scheme");
}
export function applyCustomTheme(theme: CustomTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme.base === "light" ? "light" : "graphite";
  root.style.colorScheme = theme.base;
  for (const key of colourKeys)
    root.style.setProperty(`--${key}`, theme.colours[key]);
  const accent = theme.colours.accent;
  root.style.setProperty("--accent-ink", accentInk(accent));
  root.style.setProperty("--accent-soft", accent + "18");
  root.style.setProperty("--border", theme.colours.text + "16");
  root.style.setProperty("--hover", theme.colours.text + "08");
}
export function captureTheme(): ThemePalette {
  const style = getComputedStyle(document.documentElement);
  const colours = {} as Record<ColourKey, string>;
  for (const key of colourKeys) {
    const value = style.getPropertyValue(`--${key}`).trim();
    colours[key] = /^#[0-9a-f]{3}$/i.test(value)
      ? "#" + [...value.slice(1)].map((c) => c + c).join("")
      : value;
  }
  return parseTheme({
    version: 1,
    name: "My theme",
    base: document.documentElement.dataset.theme === "light" ? "light" : "dark",
    colours,
  });
}
