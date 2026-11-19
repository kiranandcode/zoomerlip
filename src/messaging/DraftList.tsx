import { useEffect, useRef, useState } from "react";
import type { Account } from "../types";
import { deleteDraft, listDrafts, syncDrafts } from "./drafts";
import type { Draft } from "./drafts";
export function DraftList({
  account,
  onRestore,
  onClose,
}: {
  account: Account;
  onRestore: (draft: Draft) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState(() => listDrafts(account.id));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const control = useRef(new AbortController());
  useEffect(() => {
    control.current = new AbortController();
    const refresh = () => setDrafts(listDrafts(account.id));
    window.addEventListener("storage", refresh);
    return () => {
      control.current.abort();
      window.removeEventListener("storage", refresh);
    };
  }, [account.id]);
  return (
    <section className="messaging-panel" aria-label="Saved drafts">
      <header>
        <strong>Drafts</strong>
        <button onClick={onClose}>Close</button>
      </header>
      <p>
        Stored on this device. Sync keeps distinct versions as separate copies.
        It never sends messages.
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setStatus("Syncing…");
          try {
            await syncDrafts(account, control.current.signal);
            if (!control.current.signal.aborted) {
              setDrafts(listDrafts(account.id));
              setStatus(
                "Synced copies. Server copies remain until deleted on the server.",
              );
            }
          } catch (e) {
            if (!control.current.signal.aborted)
              setStatus(e instanceof Error ? e.message : "Sync failed.");
          } finally {
            if (!control.current.signal.aborted) setBusy(false);
          }
        }}
      >
        Sync copies with server
      </button>
      <p role="status">{status}</p>
      {!drafts.length && <p>No saved drafts.</p>}
      {drafts.map((d) => (
        <article key={d.id}>
          <strong>
            {d.view.type === "channel"
              ? `Channel ${d.view.channelId} · ${d.topic}`
              : `DM ${d.view.userIds.join(", ")}`}
          </strong>
          <p>{d.text.slice(0, 240)}</p>
          <button onClick={() => onRestore(d)}>Restore</button>
          <button
            onClick={() => {
              deleteDraft(account.id, d.id);
              setDrafts(listDrafts(account.id));
            }}
          >
            Delete local copy
          </button>
        </article>
      ))}
    </section>
  );
}
