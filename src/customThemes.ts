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
export type CustomTheme = {
  id: string;
  name: string;
  base: "dark" | "light";
  colours: Record<ColourKey, string>;
};
const storageKey = "zoomerlip.themes.v1";
export const maxThemes = 20;
export function parseTheme(input: unknown): Omit<CustomTheme, "id"> {
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
    const list = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    return list.slice(0, maxThemes).flatMap((item) => {
      try {
        if (
          typeof item.id !== "string" ||
          !/^[a-zA-Z0-9-]{1,80}$/.test(item.id)
        )
          return [];
        if (seen.has(item.id)) return [];
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
export function writeThemes(themes: CustomTheme[]) {
  if (themes.length > maxThemes)
    throw new Error(
      `Keep at most ${maxThemes} custom themes. Delete one first.`,
    );
  try {
    localStorage.setItem(storageKey, JSON.stringify(themes));
  } catch {
    throw new Error(
      "Browser storage is unavailable or full. Your theme was not saved.",
    );
  }
}
export function themeJSON(theme: CustomTheme) {
  return JSON.stringify(
    { version: 1, name: theme.name, base: theme.base, colours: theme.colours },
    null,
    2,
  );
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
  root.style.setProperty(
    "--accent-ink",
    contrast(accent, "#ffffff") > contrast(accent, "#15202b")
      ? "#ffffff"
      : "#15202b",
  );
  root.style.setProperty("--accent-soft", accent + "18");
  root.style.setProperty("--border", theme.colours.text + "16");
  root.style.setProperty("--hover", theme.colours.text + "08");
}
export function captureTheme(): Omit<CustomTheme, "id"> {
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
