import { useEffect, useMemo, useRef, useState } from "react";
import { applyPreferences, readPreferences } from "../appearance";
import type { Preferences } from "../appearance";
import {
  applyCustomTheme,
  captureTheme,
  colourKeys,
  deleteTheme,
  maxThemes,
  parseTheme,
  readThemes,
  saveTheme,
  subscribeThemes,
  themeContrast,
  themeFilename,
  themeJSON,
  themeRevision,
  ThemeConflictError,
} from "../customThemes";
import type { CustomTheme } from "../customThemes";
const labels = {
  rail: "Server rail",
  sidebar: "Sidebar",
  surface: "Messages",
  raised: "Raised surfaces",
  field: "Input fields",
  text: "Main text",
  secondary: "Message text",
  muted: "Secondary text",
  accent: "Accent",
};
type Draft = { theme: CustomTheme; revision: string | null };
// Session memory only. Closing the dialog must not destroy an unsaved palette.
let retainedDraft: Draft | null = null;
let retainedUndo: { theme: CustomTheme; wasActive: boolean } | null = null;
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
    [draft, setDraftState] = useState<Draft | null>(retainedDraft),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [busy, setBusy] = useState(false),
    [allowLowContrast, setAllowLowContrast] = useState(false),
    [undo, setUndo] = useState(retainedUndo);
  const file = useRef<HTMLInputElement>(null),
    importGeneration = useRef(0),
    frame = useRef<number | undefined>(undefined);
  const setDraft = (next: Draft | null) => {
    importGeneration.current++;
    retainedDraft = next;
    setDraftState(next);
    setConflict(false);
    setAllowLowContrast(false);
  };
  const begin = (next: Draft) => {
    setDraft(next);
    setError("");
  };
  useEffect(() => {
    onEditing(!!draft);
  }, [!!draft, onEditing]);
  useEffect(
    () => () => {
      importGeneration.current++;
      onEditing(false);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      applyPreferences(readPreferences());
    },
    [onEditing],
  );
  useEffect(() => subscribeThemes(() => setThemes(readThemes())), []);
  useEffect(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    if (!draft) {
      applyPreferences(prefs);
      return;
    }
    try {
      const valid = {
        ...parseTheme({ ...draft.theme, version: 1 }),
        id: draft.theme.id,
      };
      frame.current = requestAnimationFrame(() => {
        applyCustomTheme(valid);
        frame.current = undefined;
      });
    } catch {
      /* Incomplete hex input retains the previous preview. */
    }
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [draft, prefs, themes]);
  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : "Theme operation failed.");
    setConflict(e instanceof ThemeConflictError);
  }
  async function save(copy = false) {
    if (!draft || busy) return;
    if (criticalContrast && !allowLowContrast) {
      setError(
        "Confirm the low contrast choice before saving, or improve the marked colours.",
      );
      return;
    }
    setBusy(true);
    try {
      const theme = copy
        ? { ...draft.theme, id: crypto.randomUUID() }
        : draft.theme;
      const saved = await saveTheme(theme, copy ? null : draft.revision);
      setThemes(readThemes());
      onChange({ theme: "custom", customId: saved.id });
      setDraft(null);
      setError("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove(theme: CustomTheme) {
    if (busy) return;
    setBusy(true);
    try {
      const deleted = await deleteTheme(theme);
      if (!deleted) return;
      const wasActive = prefs.theme === "custom" && prefs.customId === theme.id;
      retainedUndo = { theme: deleted, wasActive };
      setUndo(retainedUndo);
      setThemes(readThemes());
      if (wasActive) onChange({ theme: "graphite", customId: undefined });
      if (draft?.theme.id === theme.id) setDraft(null);
      setError("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function undoDelete() {
    if (!undo || busy) return;
    setBusy(true);
    try {
      const restored = await saveTheme(undo.theme, null);
      if (undo.wasActive) onChange({ theme: "custom", customId: restored.id });
      retainedUndo = null;
      setUndo(null);
      setError("");
      setThemes(readThemes());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  function download(theme: CustomTheme) {
    const url = URL.createObjectURL(
      new Blob([themeJSON(theme)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = themeFilename(theme);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(selected?: File) {
    if (!selected || busy) return;
    const generation = ++importGeneration.current;
    if (file.current) file.current.value = "";
    try {
      if (selected.size > 32768)
        throw new Error("Theme files must be smaller than 32 KB.");
      const parsed = parseTheme(JSON.parse(await selected.text()));
      if (generation !== importGeneration.current) return;
      begin({ theme: { ...parsed, id: crypto.randomUUID() }, revision: null });
    } catch (e) {
      if (generation === importGeneration.current)
        fail(
          e instanceof SyntaxError
            ? new Error("This file is not valid JSON.")
            : e,
        );
    }
  }
  const checks = useMemo(() => {
    if (!draft) return [];
    try {
      return themeContrast(parseTheme({ ...draft.theme, version: 1 }));
    } catch {
      return [];
    }
  }, [draft]);
  const failures = checks.filter((check) => check.ratio < 4.5),
    theme = draft?.theme;
  const criticalContrast = failures.some((check) => check.ratio < 3);
  function change(patch: Partial<CustomTheme>) {
    if (draft) setDraft({ ...draft, theme: { ...draft.theme, ...patch } });
  }
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
              disabled={busy || !!draft}
              aria-pressed={
                prefs.theme === "custom" && prefs.customId === theme.id
              }
              onClick={() => onChange({ theme: "custom", customId: theme.id })}
            >
              <span
                className="custom-colour"
                style={{ background: theme.colours.accent }}
              />
              {theme.name}
            </button>
            <button
              disabled={busy || !!draft}
              aria-label={`Edit ${theme.name}`}
              onClick={() =>
                begin({
                  theme: { ...theme, colours: { ...theme.colours } },
                  revision: themeRevision(theme),
                })
              }
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
              disabled={busy || !!draft}
              aria-label={`Delete ${theme.name}`}
              onClick={() => void remove(theme)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      {undo && (
        <div className="theme-undo" role="status">
          <span>Deleted {undo.theme.name}.</span>
          <button disabled={busy} onClick={() => void undoDelete()}>
            Undo deletion
          </button>
        </div>
      )}
      <div className="custom-tools">
        <button
          disabled={busy || !!draft || themes.length >= maxThemes}
          onClick={() => {
            try {
              begin({
                theme: { ...captureTheme(), id: crypto.randomUUID() },
                revision: null,
              });
            } catch (e) {
              fail(e);
            }
          }}
        >
          Create theme
        </button>
        <button
          disabled={busy || !!draft || themes.length >= maxThemes}
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
          disabled={busy}
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
      </div>
      {draft && theme && (
        <form
          className="theme-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="theme-draft-notice">
            Your unsaved draft stays here if you close Appearance.
          </p>
          <fieldset disabled={busy}>
            <label>
              Theme name
              <input
                autoComplete="off"
                maxLength={48}
                required
                value={theme.name}
                onChange={(e) => change({ name: e.target.value })}
              />
            </label>
            <label>
              Base
              <select
                value={theme.base}
                onChange={(e) =>
                  change({ base: e.target.value as "dark" | "light" })
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
                        /^#[0-9a-f]{6}$/i.test(theme.colours[key])
                          ? theme.colours[key]
                          : "#000000"
                      }
                      onChange={(e) =>
                        change({
                          colours: { ...theme.colours, [key]: e.target.value },
                        })
                      }
                    />
                    <input
                      aria-label={`${labels[key]} hex`}
                      value={theme.colours[key]}
                      pattern="#[0-9A-Fa-f]{6}"
                      maxLength={7}
                      required
                      spellCheck={false}
                      onChange={(e) =>
                        change({
                          colours: { ...theme.colours, [key]: e.target.value },
                        })
                      }
                    />
                  </div>
                </label>
              ))}
            </div>
            <div className="theme-contrast" aria-live="polite">
              {!checks.length ? (
                <p>Enter six-digit hex colours.</p>
              ) : failures.length ? (
                <>
                  <p>
                    Low contrast in {failures.length} text pairs. Aim for 4.5:1.
                  </p>
                  <ul>
                    {failures.map((check) => (
                      <li key={check.label}>
                        {check.label}: {check.ratio.toFixed(2)}:1
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>All checked text pairs meet 4.5:1.</p>
              )}
            </div>
            {criticalContrast && (
              <label className="theme-low-contrast">
                <input
                  type="checkbox"
                  checked={allowLowContrast}
                  onChange={(e) => setAllowLowContrast(e.target.checked)}
                />
                Save despite low contrast
              </label>
            )}
            <div className="custom-tools">
              <button className="primary" type="submit">
                Save custom theme
              </button>
              {(draft.revision !== null || conflict) && (
                <button type="button" onClick={() => void save(true)}>
                  Save as copy
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setError("");
                }}
              >
                Cancel editing
              </button>
              <button type="button" onClick={() => download(theme)}>
                Export draft
              </button>
            </div>
          </fieldset>
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
