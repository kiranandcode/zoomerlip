import { useEffect, useRef, useState } from "react";
import { request } from "../api";
import type { Account } from "../types";
import type { Destination } from "./drafts";
import { messagingCapabilities } from "./capabilities";
import {
  futureTimestamp,
  listProductivity,
  localDateTime,
  minimumLevel,
  rescheduleReminder,
  timezone,
} from "./productivity";
import type { ProductivityItem, ProductivityKind } from "./productivity";
const labels = {
  scheduled_messages: "Scheduled messages",
  saved_snippets: "Saved snippets",
  reminders: "Reminders",
};
export function ProductivityPanel({
  account,
  kind,
  view,
  text,
  topic,
  onInsert,
  onClose,
}: {
  account: Account;
  kind: ProductivityKind;
  view: Destination;
  text: string;
  topic: string;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ProductivityItem[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [edit, setEdit] = useState<ProductivityItem | null>(null),
    [content, setContent] = useState(text),
    [title, setTitle] = useState(""),
    [editTopic, setTopic] = useState(topic),
    [when, setWhen] = useState(""),
    [note, setNote] = useState("");
  const lifetime = useRef(new AbortController()),
    loadControl = useRef<AbortController | undefined>(undefined),
    busyRef = useRef(false);
  const limits = messagingCapabilities(account.id),
    supported = limits.featureLevel >= minimumLevel[kind];
  async function refresh() {
    loadControl.current?.abort();
    const c = new AbortController();
    loadControl.current = c;
    setLoading(true);
    try {
      const d = await listProductivity(account, kind, c.signal);
      if (!c.signal.aborted && !lifetime.current.signal.aborted) setItems(d);
    } catch (e) {
      if (!c.signal.aborted && !lifetime.current.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not load items.");
    } finally {
      if (!c.signal.aborted && !lifetime.current.signal.aborted)
        setLoading(false);
    }
  }
  useEffect(() => {
    lifetime.current = new AbortController();
    void refresh();
    const reset = (e: Event) => {
      if ((e as CustomEvent).detail.accountId === account.id) {
        lifetime.current.abort();
        loadControl.current?.abort();
        setItems([]);
        setContent("");
        onClose();
      }
    };
    const event = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (
        d.accountId === account.id &&
        d.events.some((e: { type: string }) => e.type === kind)
      )
        void refresh();
    };
    const wake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("zoomerlip-messaging-reset", reset);
    window.addEventListener("zoomerlip-messaging", event);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      lifetime.current.abort();
      loadControl.current?.abort();
      window.removeEventListener("zoomerlip-messaging-reset", reset);
      window.removeEventListener("zoomerlip-messaging", event);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [account.id, kind]);
  async function run(work: () => Promise<void>) {
    if (busyRef.current || lifetime.current.signal.aborted) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await work();
      if (!lifetime.current.signal.aborted) {
        setStatus("Saved on the server.");
        setEdit(null);
        await refresh();
      }
    } catch (e) {
      if (!lifetime.current.signal.aborted) {
        setError(
          `${e instanceof Error ? e.message : "Operation failed."} Your editor is unchanged. Refresh before retrying an uncertain creation.`,
        );
        await refresh();
      }
    } finally {
      busyRef.current = false;
      if (!lifetime.current.signal.aborted) setBusy(false);
    }
  }
  async function save() {
    if (kind === "reminders") {
      if (edit)
        await rescheduleReminder(
          account,
          edit,
          when,
          note,
          lifetime.current.signal,
        );
      return;
    }
    if (!content.trim() || content.length > limits.messageLength)
      throw new Error(
        `Content must contain 1–${limits.messageLength} characters.`,
      );
    if (kind === "saved_snippets" && edit && limits.featureLevel < 368)
      throw new Error("Editing snippets requires server feature level 368.");
    if (kind === "saved_snippets" && !title.trim())
      throw new Error("Give the snippet a title.");
    const stream = edit ? edit.type === "stream" : view.type === "channel";
    if (
      kind === "scheduled_messages" &&
      stream &&
      (!editTopic.trim() || editTopic.length > limits.topicLength)
    )
      throw new Error("Enter a valid channel topic.");
    const params =
      kind === "saved_snippets"
        ? { title, content }
        : {
            content,
            type: stream ? "stream" : "private",
            to: edit
              ? edit.to
              : view.type === "channel"
                ? view.channelId
                : view.userIds,
            ...(stream ? { topic: editTopic } : {}),
            scheduled_delivery_timestamp: futureTimestamp(when),
          };
    await request(
      account,
      `/${kind}${edit ? `/${edit.id}` : ""}`,
      params,
      edit ? "PATCH" : "POST",
      lifetime.current.signal,
    );
  }
  return (
    <section className="messaging-panel" aria-label={labels[kind]}>
      <header>
        <strong>{labels[kind]}</strong>
        <button onClick={onClose}>Close</button>
      </header>
      <p>
        Timezone: {timezone()}. Delivery is handled by the organization server.
      </p>
      {!supported ? (
        <p role="status">
          Requires server feature level {minimumLevel[kind]}. These controls are
          unavailable on this server.
        </p>
      ) : (
        <>
          <button disabled={loading} onClick={() => void refresh()}>
            Refresh list
          </button>
          {loading && <p role="status">Loading…</p>}
          {!loading && !items.length && <p>No {labels[kind].toLowerCase()}.</p>}
          {items.map((item) => (
            <article key={item.id}>
              <strong>
                {item.title ||
                  `#${item.id} · ${item.type === "stream" ? `Channel ${item.to} · ${item.topic}` : kind === "reminders" ? `Message ${item.reminder_target_message_id}` : `DM ${item.to}`}`}
              </strong>
              {item.scheduled_delivery_timestamp && (
                <p>
                  {new Date(
                    item.scheduled_delivery_timestamp * 1000,
                  ).toLocaleString()}{" "}
                  · {timezone()}
                </p>
              )}
              {item.failed && (
                <strong role="status">
                  Delivery failed. Edit the time and retry.
                </strong>
              )}
              <p>{item.content}</p>
              <button
                disabled={
                  busy ||
                  (kind === "saved_snippets" && limits.featureLevel < 368)
                }
                onClick={() => {
                  setEdit(item);
                  setContent(item.content);
                  setTitle(item.title || "");
                  setTopic(item.topic || "");
                  setWhen(
                    item.scheduled_delivery_timestamp
                      ? localDateTime(item.scheduled_delivery_timestamp)
                      : "",
                  );
                  setNote("");
                }}
              >
                {kind === "reminders" ? "Reschedule" : "Edit"}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete this ${kind === "saved_snippets" ? "snippet" : "scheduled item"}?`,
                    )
                  )
                    void run(async () => {
                      await request(
                        account,
                        `/${kind}/${item.id}`,
                        {},
                        "DELETE",
                        lifetime.current.signal,
                      );
                    });
                }}
              >
                Delete
              </button>
              {kind === "saved_snippets" && (
                <button onClick={() => onInsert(item.content)}>
                  Insert snippet
                </button>
              )}
            </article>
          ))}
          {(kind !== "reminders" || edit) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(save);
              }}
            >
              <strong>{edit ? `Edit #${edit.id}` : "Create"}</strong>
              {kind === "saved_snippets" && (
                <label>
                  Snippet title
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    maxLength={100}
                  />
                </label>
              )}
              {kind !== "reminders" && (
                <label>
                  Content
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    required
                    rows={3}
                  />
                </label>
              )}
              {kind === "scheduled_messages" && (
                <>
                  <p>
                    Destination:{" "}
                    {edit
                      ? `${edit.type} ${edit.to}`
                      : view.type === "channel"
                        ? `Channel ${view.channelId}`
                        : `DM ${view.userIds.join(", ")}`}
                  </p>
                  {(edit
                    ? edit.type === "stream"
                    : view.type === "channel") && (
                    <label>
                      Scheduled topic
                      <input
                        value={editTopic}
                        onChange={(e) => setTopic(e.target.value)}
                        required
                      />
                    </label>
                  )}
                </>
              )}
              {kind !== "saved_snippets" && (
                <label>
                  Delivery time ({timezone()})
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    required
                  />
                </label>
              )}
              {kind === "reminders" && (
                <>
                  <p>
                    Reschedule creates a replacement before deleting the old
                    reminder. A partial failure can leave both. Existing notes
                    cannot be recovered separately; enter a replacement note.
                  </p>
                  {limits.featureLevel >= 415 && (
                    <label>
                      Replacement note
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                  )}
                </>
              )}
              <button disabled={busy}>
                {busy
                  ? "Saving…"
                  : edit
                    ? kind === "reminders"
                      ? "Confirm reschedule"
                      : "Save changes"
                    : kind === "scheduled_messages"
                      ? "Schedule message"
                      : "Save snippet"}
              </button>
              {edit && (
                <button type="button" onClick={() => setEdit(null)}>
                  Cancel edit
                </button>
              )}
            </form>
          )}
          {kind === "reminders" && !edit && (
            <p>Create reminders from a message's actions.</p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <p role="status">{status}</p>
    </section>
  );
}
