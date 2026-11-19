import { applyCustomTheme, clearCustomTheme, readThemes } from "./customThemes";
export type Preferences = {
  theme: "graphite" | "midnight" | "light" | "custom";
  customId?: string;
  accent: "lime" | "mint" | "violet" | "coral";
  density: "cozy" | "compact";
  fontSize: number;
  motion: boolean;
};
export const defaults: Preferences = {
  theme: "graphite",
  accent: "mint",
  density: "cozy",
  fontSize: 15,
  motion: true,
};
const key = "zoomerlip.appearance.v1";
export function readPreferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem(key) || "{}");
    if (
      p.theme === "custom" &&
      !readThemes().some((t) => t.id === p.customId)
    ) {
      p.theme = "graphite";
      delete p.customId;
    }
    return {
      theme: ["graphite", "midnight", "light", "custom"].includes(p.theme)
        ? p.theme
        : defaults.theme,
      customId: typeof p.customId === "string" ? p.customId : undefined,
      accent: ["lime", "mint", "violet", "coral"].includes(p.accent)
        ? p.accent
        : defaults.accent,
      density: p.density === "compact" ? "compact" : "cozy",
      fontSize:
        typeof p.fontSize === "number"
          ? Math.max(13, Math.min(18, p.fontSize))
          : 15,
      motion: typeof p.motion === "boolean" ? p.motion : true,
    };
  } catch {
    return defaults;
  }
}
export function applyPreferences(p: Preferences) {
  clearCustomTheme();
  const root = document.documentElement;
  root.dataset.theme = p.theme === "custom" ? "graphite" : p.theme;
  root.dataset.accent = p.accent;
  root.dataset.density = p.density;
  root.dataset.motion = p.motion ? "on" : "off";
  root.style.setProperty("--message-size", `${p.fontSize}px`);
  if (p.theme === "custom") {
    const theme = readThemes().find((t) => t.id === p.customId);
    if (theme) applyCustomTheme(theme);
  }
}
export function savePreferences(p: Preferences) {
  applyPreferences(p);
  try {
    localStorage.setItem(key, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}
