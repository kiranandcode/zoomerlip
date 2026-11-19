import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { getFeatureLevel, request } from "../api";
import type { Account } from "../types";
import { liveStore, useLive } from "./store";
export function ReadReceipts({
  account,
  messageId,
}: {
  account: Account;
  messageId: number;
}) {
  const [open, setOpen] = useState(false);
  if (getFeatureLevel(account.url) < 137) return null;
  return (
    <>
      <button
        className="icon-button"
        aria-label="Read receipts"
        title="Read receipts"
        onClick={() => setOpen(true)}
      >
        <Eye size={17} />
      </button>
      {open && (
        <ReceiptDialog
          account={account}
          messageId={messageId}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
function ReceiptDialog({
  account,
  messageId,
  close,
}: {
  account: Account;
  messageId: number;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    live = useLive(account);
  const [ids, setIds] = useState<number[]>(),
    [error, setError] = useState(""),
    [revision, refresh] = useState(0);
  const store = liveStore(account.id),
    generation = store.generation;
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setIds(undefined);
    setError("");
    if (!live.ready) {
      setError("Session unavailable.");
      return;
    }
    if (live.settings.realm_enable_read_receipts === false) {
      setError("Read receipts are disabled by this organization.");
      return;
    }
    request<{ user_ids: number[] }>(
      account,
      `/messages/${messageId}/read_receipts`,
      {},
      "GET",
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted && generation === store.generation)
          setIds(data.user_ids);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not load read receipts.",
          );
      });
    return () => controller.abort();
  }, [
    account,
    messageId,
    revision,
    generation,
    live.ready,
    live.settings.realm_enable_read_receipts,
    store,
  ]);
  return (
    <dialog
      ref={ref}
      className="receipt-dialog"
      onCancel={close}
      aria-label="Read receipts"
    >
      <h2>Read receipts</h2>
      <p>Only readers whose privacy settings permit sharing are listed.</p>
      {error ? (
        <p role="alert">{error}</p>
      ) : ids ? (
        <p>
          {ids.length
            ? `Read by: ${ids.map((id) => live.names[id] || `User ${id}`).join(", ")}`
            : "No shared read receipts."}
        </p>
      ) : (
        <p role="status">Loading…</p>
      )}
      <button onClick={() => refresh((r) => r + 1)}>Refresh</button>
      <button onClick={close}>Close</button>
    </dialog>
  );
}
