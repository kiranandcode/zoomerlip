import { useEffect, useRef, useState } from "react";
import type { Account } from "../types";
import { createReminder, timezone } from "./productivity";
import { messagingCapabilities } from "./capabilities";
export function ReminderForm({
  account,
  messageId,
}: {
  account: Account;
  messageId: number;
}) {
  const [when, setWhen] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const control = useRef(new AbortController());
  useEffect(() => {
    control.current = new AbortController();
    const reset = (e: Event) => {
      if ((e as CustomEvent).detail.accountId === account.id) {
        control.current.abort();
        setNote("");
        setWhen("");
      }
    };
    window.addEventListener("zoomerlip-messaging-reset", reset);
    return () => {
      control.current.abort();
      window.removeEventListener("zoomerlip-messaging-reset", reset);
    };
  }, []);
  const level = messagingCapabilities(account.id).featureLevel;
  if (level < 381)
    return <p>Reminders require server feature level 381 or newer.</p>;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          await createReminder(
            account,
            messageId,
            when,
            note,
            control.current.signal,
          );
          if (!control.current.signal.aborted)
            setStatus("Reminder scheduled on the server.");
        } catch (e) {
          if (!control.current.signal.aborted)
            setStatus(
              `${e instanceof Error ? e.message : "Reminder failed."} Check the reminder list before retrying.`,
            );
        } finally {
          if (!control.current.signal.aborted) setBusy(false);
        }
      }}
    >
      <label>
        Remind me ({timezone()})
        <input
          type="datetime-local"
          required
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </label>
      {level >= 415 && (
        <label>
          Reminder note
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      <button disabled={busy}>Create reminder</button>
      <p role="status">{status}</p>
    </form>
  );
}
