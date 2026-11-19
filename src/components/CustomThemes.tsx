import { useEffect, useRef, useState } from "react";
import { applyPreferences } from "../appearance";
import type { Preferences } from "../appearance";
import {
  applyCustomTheme,
  captureTheme,
  colourKeys,
  contrast,
  maxThemes,
  parseTheme,
  readThemes,
  themeJSON,
  writeThemes,
} from "../customThemes";
import type { CustomTheme } from "../customThemes";
const labels = {
  rail: "Server rail",
  sidebar: "Sidebar",
  surface: "Messages",
  raised: "Composer",
  field: "Input fields",
  text: "Headings",
  secondary: "Message text",
  muted: "Secondary text",
  accent: "Accent",
};
export function CustomThemes({
  prefs,
  onChange,
  onEditing,
}: {
  prefs: Preferences;
  onChange: (patch: Partial<Preferences>) => void;
  onEditing: (editing: boolean) => void;
}) {
  const [themes, setThemes] = useState(readThemes),
    [draft, setDraftState] = useState<CustomTheme | null>(null),
    [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const importGeneration = useRef(0);
  const setDraft = (next: CustomTheme | null) => {
    importGeneration.current++;
    setDraftState(next);
  };
  useEffect(() => {
    onEditing(!!draft);
  }, [!!draft, onEditing]);
  useEffect(
    () => () => {
      importGeneration.current++;
      onEditing(false);
    },
    [onEditing],
  );
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === "zoomerlip.themes.v1")
        setThemes(readThemes());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    applyPreferences(prefs);
    if (draft) {
      try {
        applyCustomTheme({
          ...parseTheme({ ...draft, version: 1 }),
          id: draft.id,
        });
      } catch {
        /* Keep the saved theme while a hex value is incomplete. */
      }
    }
    return () => applyPreferences(prefs);
  }, [draft, prefs]);
  function save() {
    if (!draft) return;
    try {
      const theme = { ...parseTheme({ ...draft, version: 1 }), id: draft.id };
      const next = readThemes().some((t) => t.id === theme.id)
        ? readThemes().map((t) => (t.id === theme.id ? theme : t))
        : [...readThemes(), theme];
      writeThemes(next);
      setThemes(next);
      onChange({ theme: "custom", customId: theme.id });
      setDraft(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function remove(theme: CustomTheme) {
    try {
      const next = readThemes().filter((t) => t.id !== theme.id);
      writeThemes(next);
      setThemes(next);
      if (prefs.theme === "custom" && prefs.customId === theme.id)
        onChange({ theme: "graphite", customId: undefined });
      if (draft?.id === theme.id) setDraft(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function download(theme: CustomTheme) {
    const url = URL.createObjectURL(
      new Blob([themeJSON(theme)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "zoomerlip-theme.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(selected?: File) {
    if (!selected) return;
    const generation = ++importGeneration.current;
    try {
      if (selected.size > 32768)
        throw new Error("Theme files must be smaller than 32 KB.");
      const parsed = parseTheme(JSON.parse(await selected.text()));
      if (generation !== importGeneration.current) return;
      setDraft({ ...parsed, id: crypto.randomUUID() });
      setError("");
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "This file is not valid JSON."
          : (e as Error).message,
      );
    } finally {
      if (file.current) file.current.value = "";
    }
  }
  const ratio =
    draft &&
    /^#[0-9a-f]{6}$/i.test(draft.colours.secondary) &&
    /^#[0-9a-f]{6}$/i.test(draft.colours.surface)
      ? contrast(draft.colours.secondary, draft.colours.surface)
      : null;
  return (
    <section className="custom-themes" aria-label="Custom themes">
      <div className="custom-heading">
        <h3>Custom themes</h3>
        <span>
          {themes.length}/{maxThemes}
        </span>
      </div>
      <p>
        Personal palettes stay in this browser. Export a theme only when you
        want a copy.
      </p>
      <div className="custom-library">
        {themes.map((theme) => (
          <div className="custom-theme-row" key={theme.id}>
            <button
              className="custom-select"
              aria-pressed={
                prefs.theme === "custom" && prefs.customId === theme.id
              }
              onClick={() => {
                setDraft(null);
                onChange({ theme: "custom", customId: theme.id });
              }}
            >
              <span
                className="custom-colour"
                style={{ background: theme.colours.accent }}
              />
              {theme.name}
            </button>
            <button
              aria-label={`Edit ${theme.name}`}
              onClick={() => {
                setDraft({ ...theme, colours: { ...theme.colours } });
                setError("");
              }}
            >
              Edit
            </button>
            <button
              aria-label={`Export ${theme.name}`}
              onClick={() => download(theme)}
            >
              Export
            </button>
            <button
              aria-label={`Delete ${theme.name}`}
              onClick={() => remove(theme)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <div className="custom-tools">
        <button
          disabled={themes.length >= maxThemes}
          onClick={() => {
            setDraft({ ...captureTheme(), id: crypto.randomUUID() });
            setError("");
          }}
        >
          Create theme
        </button>
        <button
          disabled={themes.length >= maxThemes}
          onClick={() => file.current?.click()}
        >
          Import JSON
        </button>
        <input
          ref={file}
          hidden
          type="file"
          accept=".json,application/json"
          aria-label="Import theme file"
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
      </div>
      {draft && (
        <form
          className="theme-editor"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label>
            Theme name
            <input
              autoComplete="off"
              maxLength={48}
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Base
            <select
              value={draft.base}
              onChange={(e) =>
                setDraft({ ...draft, base: e.target.value as "dark" | "light" })
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <div className="colour-grid">
            {colourKeys.map((key) => (
              <label key={key}>
                <span>{labels[key]}</span>
                <div>
                  <input
                    type="color"
                    aria-label={`${labels[key]} colour`}
                    value={
                      /^#[0-9a-f]{6}$/i.test(draft.colours[key])
                        ? draft.colours[key]
                        : "#000000"
                    }
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        colours: { ...draft.colours, [key]: e.target.value },
                      })
                    }
                  />
                  <input
                    aria-label={`${labels[key]} hex`}
                    value={draft.colours[key]}
                    pattern="#[0-9A-Fa-f]{6}"
                    maxLength={7}
                    required
                    spellCheck={false}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        colours: { ...draft.colours, [key]: e.target.value },
                      })
                    }
                  />
                </div>
              </label>
            ))}
          </div>
          <p className="theme-contrast">
            {ratio === null
              ? "Enter six-digit hex colours."
              : `Message text contrast: ${ratio.toFixed(1)}:1${ratio < 4.5 ? " · Low contrast. Aim for 4.5:1." : ""}`}
          </p>
          <div className="custom-tools">
            <button className="primary" type="submit">
              Save custom theme
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError("");
              }}
            >
              Cancel editing
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
