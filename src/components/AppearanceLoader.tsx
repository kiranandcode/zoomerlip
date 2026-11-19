import { useEffect, useRef, useState } from "react";
import type { Appearance as AppearanceComponent } from "./Appearance";

// Settings and the theme editor do not belong on the initial chat path.
export function Appearance({ onClose }: { onClose: () => void }) {
  const [Component, setComponent] = useState<typeof AppearanceComponent>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void import("./Appearance").then(
      (module) => {
        if (active) setComponent(() => module.Appearance);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return Component ? (
    <Component onClose={onClose} />
  ) : (
    <Pending onClose={onClose} error={error} />
  );
}
function Pending({ onClose, error }: { onClose: () => void; error: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="appearance-dialog"
      aria-label="Appearance"
      onCancel={onClose}
    >
      <div className="appearance-panel">
        <button autoFocus onClick={onClose} aria-label="Close appearance">
          Close
        </button>
        <p role={error ? "alert" : "status"}>
          {error
            ? "Could not load appearance settings. Close and try again."
            : "Loading appearance settings…"}
        </p>
      </div>
    </dialog>
  );
}
