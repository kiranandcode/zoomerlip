import {
  applyCustomTheme,
  clearCustomTheme,
  readThemes,
  subscribeThemes,
} from "./customThemes";
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
let current: Preferences | undefined,
  storage: Storage | undefined,
  raw: string | null | undefined,
  sessionOnly = false,
  error = "";
const listeners = new Set<() => void>();
let listening = false;
function normalize(input: unknown): Preferences {
  const p = (
    input && typeof input === "object" ? input : {}
  ) as Partial<Preferences>;
  const theme = ["graphite", "midnight", "light", "custom"].includes(
    p.theme || "",
  )
    ? p.theme!
    : defaults.theme;
  const customId =
    theme === "custom" && readThemes().some((t) => t.id === p.customId)
      ? p.customId
      : undefined;
  return {
    theme: theme === "custom" && !customId ? "graphite" : theme,
    customId,
    accent: ["lime", "mint", "violet", "coral"].includes(p.accent || "")
      ? p.accent!
      : defaults.accent,
    density: p.density === "compact" ? "compact" : "cozy",
    fontSize:
      typeof p.fontSize === "number" && Number.isFinite(p.fontSize)
        ? Math.max(13, Math.min(18, p.fontSize))
        : 15,
    motion: typeof p.motion === "boolean" ? p.motion : true,
  };
}
function storageValue() {
  try {
    if (storage !== localStorage) {
      storage = localStorage;
      current = undefined;
      sessionOnly = false;
      raw = undefined;
      error = "";
    }
    return localStorage.getItem(key);
  } catch {
    return undefined;
  }
}
export function readPreferences(): Preferences {
  const value = storageValue();
  if (current && (sessionOnly || value === raw)) return current;
  raw = value;
  try {
    current = normalize(JSON.parse(value || "{}"));
  } catch {
    current = { ...defaults };
  }
  return current;
}
function notify() {
  listeners.forEach((fn) => fn());
}
function sync() {
  sessionOnly = false;
  current = undefined;
  raw = undefined;
  error = "";
  applyPreferences(readPreferences());
  notify();
}
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key === key) sync();
  });
  subscribeThemes(() => {
    const previous = readPreferences();
    const next = normalize(previous);
    if (JSON.stringify(previous) !== JSON.stringify(next)) current = next;
    applyPreferences(current || previous);
    notify();
  });
}
export function subscribePreferences(listener: () => void) {
  listen();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const preferenceError = () => {
  readPreferences();
  return error;
};
export function applyPreferences(p: Preferences) {
  listen();
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
  storageValue();
  current = normalize(p);
  applyPreferences(current);
  try {
    const value = JSON.stringify(current);
    localStorage.setItem(key, value);
    raw = value;
    sessionOnly = false;
    error = "";
  } catch {
    sessionOnly = true;
    error =
      "Applied for this session. Browser storage is unavailable; changes were not saved.";
  }
  notify();
  return !sessionOnly;
}
/** An always-readable recovery route, also available before sign-in. */
export function resetAppearance() {
  return savePreferences({ ...defaults });
}
