export type Preferences = {
  theme: "graphite" | "midnight" | "light";
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
    return {
      theme: ["graphite", "midnight", "light"].includes(p.theme)
        ? p.theme
        : defaults.theme,
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
  const root = document.documentElement;
  root.dataset.theme = p.theme;
  root.dataset.accent = p.accent;
  root.dataset.density = p.density;
  root.dataset.motion = p.motion ? "on" : "off";
  root.style.setProperty("--message-size", `${p.fontSize}px`);
}
export function savePreferences(p: Preferences) {
  applyPreferences(p);
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    /* Preferences still apply for this session. */
  }
}
