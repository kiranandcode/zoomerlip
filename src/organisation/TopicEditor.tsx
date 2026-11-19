import { useEffect, useRef, useState } from "react";
import type { Account, Channel, Message } from "../types";
import type { Access } from "./permissions";
import { canTopic } from "./permissions";
import { moveTopic, topicAnchor } from "./topics";
import type { Propagation } from "./topics";
import { invalidateOrganisation } from "./lifecycle";
import { request } from "../api";
import { getCache } from "../cache";
export function TopicEditor({
  account,
  channel,
  topic: original,
  channels,
  access,
  onClose,
}: {
  account: Account;
  channel: Channel;
  topic: string;
  channels: Channel[];
  access: Access;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    flight = useRef<AbortController | null>(null);
  const [topic, setTopic] = useState(original),
    [destination, setDestination] = useState(channel.stream_id),
    [mode, setMode] = useState<Propagation>("change_all");
  const [message, setMessage] = useState<Message | null>(null),
    [messageId, setMessageId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notify, setNotify] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    const controller = new AbortController();
    flight.current = controller;
    void topicAnchor(account, channel.stream_id, original, controller.signal)
      .then((m) => {
        if (!controller.signal.aborted) {
          setMessage(m);
          setMessageId(String(m.id));
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      flight.current?.abort();
      previous?.focus();
    };
  }, [account, channel.stream_id, original]);
  return (
    <dialog
      ref={dialog}
      className="organisation-dialog"
      aria-label="Manage topic"
      onCancel={onClose}
    >
      <h2>Manage topic</h2>
      <form
        className="organisation-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!message || busy) return;
          const target = channels.find((c) => c.stream_id === destination);
          if (
            !window.confirm(
              `Move ${mode === "change_all" ? "the whole topic" : mode === "change_later" ? "this message and later messages" : "one message"} to ${target?.name} › ${topic}? ${destination !== channel.stream_id ? "Members of the destination channel will gain access to these messages. " : ""}Existing topics with this name will be merged. ${notify ? "Move notices will be sent." : "No move notices will be sent."}`,
            )
          )
            return;
          setBusy(true);
          setError("");
          flight.current?.abort();
          const controller = new AbortController();
          flight.current = controller;
          try {
            const current = await request<{ message: Message }>(
              account,
              `/messages/${mode === "change_all" ? message.id : Number(messageId)}`,
              { apply_markdown: true },
              "GET",
              controller.signal,
            );
            if (
              current.message.stream_id !== channel.stream_id ||
              current.message.subject.toLowerCase() !== original.toLowerCase()
            )
              throw new Error(
                "The selected message no longer belongs to this topic. Reopen the topic controls.",
              );
            await moveTopic(
              account,
              access,
              channel,
              current.message,
              destination,
              topic,
              mode,
              notify,
              controller.signal,
            );
            if (!controller.signal.aborted) {
              getCache(account).invalidate();
              invalidateOrganisation(account.id);
              onClose();
            }
          } catch (e) {
            if (!controller.signal.aborted) setError((e as Error).message);
          } finally {
            if (!controller.signal.aborted) setBusy(false);
          }
        }}
      >
        <label>
          Destination channel
          <select
            value={destination}
            onChange={(e) => setDestination(Number(e.target.value))}
            disabled={!canTopic(access, channel, "move")}
          >
            {channels.map((c) => (
              <option key={c.stream_id} value={c.stream_id}>
                {c.name}
                {c.invite_only ? " (private)" : " (public)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          New topic
          <input
            value={topic}
            maxLength={Number(access.settings.max_topic_length || 60)}
            required
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
        {canTopic(access, channel, "resolve") && !!original && (
          <button
            type="button"
            onClick={() => {
              setTopic(
                original.startsWith("✔ ") ? original.slice(2) : `✔ ${original}`,
              );
              setMode("change_all");
              setDestination(channel.stream_id);
            }}
          >
            {original.startsWith("✔ ") ? "Reopen topic" : "Resolve topic"}
          </button>
        )}
        <label>
          Messages to move
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Propagation)}
          >
            <option value="change_all">Whole topic</option>
            <option value="change_one">One message</option>
            <option value="change_later">
              Selected message and later messages
            </option>
          </select>
        </label>
        {mode !== "change_all" && (
          <label>
            Starting message ID
            <input
              type="number"
              min="1"
              required
              value={messageId}
              onChange={(e) => setMessageId(e.target.value)}
            />
          </label>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          Send move notices to both topics
        </label>
        <p>
          Moves follow organisation policy and time limits. Existing messages
          keep their authors.
        </p>
        {error && <p role="alert">{error}</p>}
        {!message && !error && <p role="status">Loading topic…</p>}
        <button
          disabled={
            busy ||
            !message ||
            (topic === original && destination === channel.stream_id)
          }
        >
          {busy ? "Saving…" : "Apply topic change"}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </dialog>
  );
}
