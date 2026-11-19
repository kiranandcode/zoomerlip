import { request } from "../api";
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
    const reset = (e: Event) => {
      if ((e as CustomEvent).detail.accountId === account.id) {
        control.current.abort();
        setDrafts([]);
      }
    };
    const changed = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (
        d.accountId === account.id &&
        d.events.some((e: { type: string }) => e.type === "drafts")
      )
        setStatus("Server drafts changed. Sync copies to refresh.");
    };
    window.addEventListener("zoomerlip-messaging-reset", reset);
    window.addEventListener("zoomerlip-messaging", changed);
    window.addEventListener("storage", refresh);
    return () => {
      control.current.abort();
      window.removeEventListener("storage", refresh);
      window.removeEventListener("zoomerlip-messaging-reset", reset);
      window.removeEventListener("zoomerlip-messaging", changed);
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
          <button disabled={busy} onClick={() => onRestore(d)}>
            Restore
          </button>
          {d.serverId && (
            <button
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    "Delete this server draft copy? The local copy will remain.",
                  )
                )
                  return;
                setBusy(true);
                try {
                  await request(
                    account,
                    `/drafts/${d.serverId}`,
                    {},
                    "DELETE",
                    control.current.signal,
                  );
                  if (!control.current.signal.aborted)
                    setStatus(
                      "Server copy deleted. Local draft retained; syncing again creates a new server copy.",
                    );
                } catch (e) {
                  if (!control.current.signal.aborted)
                    setStatus(
                      e instanceof Error
                        ? e.message
                        : "Server deletion failed. Local draft retained.",
                    );
                } finally {
                  if (!control.current.signal.aborted) setBusy(false);
                }
              }}
            >
              Delete server copy
            </button>
          )}
          <button
            disabled={busy}
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
