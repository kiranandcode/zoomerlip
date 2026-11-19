import { CustomThemes } from "./CustomThemes";
import "./appearanceSafety.css";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X, Check, RotateCcw } from "lucide-react";
import {
  defaults,
  readPreferences,
  savePreferences,
  subscribePreferences,
  preferenceError,
} from "../appearance";
import type { Preferences } from "../appearance";
export function Appearance({ onClose }: { onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const prefs = useSyncExternalStore(subscribePreferences, readPreferences);
  const ref = useRef<HTMLDialogElement>(null);
  const storageError = useSyncExternalStore(
    subscribePreferences,
    preferenceError,
  );
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  const update = (patch: Partial<Preferences>) => {
    savePreferences({ ...readPreferences(), ...patch });
  };
  return (
    <dialog
      ref={ref}
      className="appearance-dialog"
      aria-label="Appearance"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="appearance-panel">
        <header>
          <div>
            <span className="eyebrow">MAKE YOURSELF AT HOME</span>
            <h2>Appearance</h2>
          </div>
          <button
            autoFocus
            className="icon-button"
            aria-label="Close appearance"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <p>Your theme. Your pace. Saved on this device.</p>
        {storageError && <p role="alert">{storageError}</p>}
        <fieldset>
          <legend>Theme</legend>
          <div className="theme-options">
            {(["graphite", "midnight", "light"] as const).map((theme) => (
              <button
                key={theme}
                className={`theme-option ${theme}`}
                aria-label={`${theme} theme`}
                disabled={editing}
                aria-pressed={prefs.theme === theme}
                onClick={() => update({ theme, customId: undefined })}
              >
                <span className="theme-preview">
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  {theme}
                  {prefs.theme === theme && <Check size={15} />}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>
            Accent colour
            {prefs.theme === "custom"
              ? " · edit your custom palette below"
              : ""}
          </legend>
          <div className="accent-options">
            {(["mint", "lime", "violet", "coral"] as const).map((accent) => (
              <button
                key={accent}
                className={`accent-swatch ${accent}`}
                aria-label={`${accent} accent`}
                disabled={editing || prefs.theme === "custom"}
                aria-pressed={prefs.accent === accent}
                onClick={() => update({ accent })}
              >
                {prefs.accent === accent && <Check size={18} />}
              </button>
            ))}
          </div>
        </fieldset>
        <CustomThemes prefs={prefs} onChange={update} onEditing={setEditing} />
        <fieldset>
          <legend>Message spacing</legend>
          <div className="segmented">
            {(["cozy", "compact"] as const).map((density) => (
              <button
                key={density}
                aria-pressed={prefs.density === density}
                onClick={() => update({ density })}
              >
                {density}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="range-label">
          Message text <span>{prefs.fontSize}px</span>
          <input
            aria-label="Message text size"
            type="range"
            min="13"
            max="18"
            value={prefs.fontSize}
            onChange={(e) => update({ fontSize: Number(e.target.value) })}
          />
        </label>
        <label className="motion-setting">
          <span>
            Smooth transitions
            <small>Also respects your system’s reduced motion setting.</small>
          </span>
          <input
            type="checkbox"
            checked={prefs.motion}
            onChange={(e) => update({ motion: e.target.checked })}
          />
        </label>
        <div className="appearance-sample">
          <span className="sample-avatar">Z</span>
          <div>
            <strong>
              Zoomerlip <small>just now</small>
            </strong>
            <p>A little more like you.</p>
          </div>
        </div>
        <button
          className="reset-appearance"
          disabled={editing}
          onClick={() => {
            update({ ...defaults, customId: undefined });
          }}
        >
          <RotateCcw size={14} />
          Reset appearance
        </button>
      </div>
    </dialog>
  );
}
