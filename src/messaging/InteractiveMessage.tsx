import { useEffect, useMemo, useRef, useState } from "react";
import { request, ApiError } from "../api";
import { getCache } from "../cache";
import type { Account, Message } from "../types";
import { messagingCapabilities } from "./capabilities";
import { readWidget, WIDGET_FEATURE_LEVEL } from "./widgets";
export function InteractiveMessage({
  account,
  message,
}: {
  account: Account;
  message: Message;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [option, setOption] = useState(""),
    [title, setTitle] = useState("");
  const control = useRef(new AbortController()),
    locked = useRef(false);
  useEffect(() => {
    control.current = new AbortController();
    const reset = (e: Event) => {
      if ((e as CustomEvent).detail.accountId === account.id) {
        control.current.abort();
        setError("Access changed. Reopen the conversation.");
      }
    };
    window.addEventListener("zoomerlip-messaging-reset", reset);
    return () => {
      control.current.abort();
      window.removeEventListener("zoomerlip-messaging-reset", reset);
    };
  }, []);
  const parsed = useMemo(() => {
    try {
      return { widget: readWidget(message, account.userId), error: "" };
    } catch (e) {
      return {
        widget: undefined,
        error:
          e instanceof Error ? e.message : "Unsupported interactive message.",
      };
    }
  }, [message, account.userId]);
  if (!message.submessages?.length) return null;
  const widget = parsed.widget;
  if (
    !widget ||
    messagingCapabilities(account.id).featureLevel < WIDGET_FEATURE_LEVEL
  )
    return (
      <p role="status">
        {parsed.error ||
          `Interactive controls require server feature level ${WIDGET_FEATURE_LEVEL}. Read the message text or open it in the organization's web client.`}
      </p>
    );
  async function submit(data: Record<string, unknown>) {
    if (locked.current || control.current.signal.aborted) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await request(
        account,
        "/submessage",
        {
          message_id: message.id,
          msg_type: "widget",
          content: JSON.stringify(data),
        },
        "POST",
        control.current.signal,
      );
      // No optimistic toggle: a repeated todo strike would undo the operation.
      const result = await request<{ message: Message }>(
        account,
        `/messages/${message.id}`,
        {},
        "GET",
        control.current.signal,
      );
      if (!control.current.signal.aborted) {
        getCache(account).events(
          (result.message.submessages || []).map((s) => ({
            ...s,
            id: -1,
            type: "submessage",
            submessage_id: s.id,
          })),
        );
        setOption("");
        setTitle("");
      }
    } catch (e) {
      if (!control.current.signal.aborted)
        setError(
          e instanceof ApiError && [404, 405].includes(e.status)
            ? "This server does not support interactive updates. Use the message text or the organization's web client."
            : `${e instanceof Error ? e.message : "Update failed."} Refresh before retrying; the server may have accepted the change.`,
        );
    } finally {
      locked.current = false;
      if (!control.current.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      className="messaging-panel messaging-widget"
      aria-label={widget.kind === "poll" ? "Poll" : "To-do list"}
    >
      <strong>{widget.title}</strong>
      {widget.options.map((o) => (
        <div key={o.key}>
          <button
            disabled={busy}
            aria-pressed={
              widget.kind === "poll"
                ? o.voters.has(account.userId)
                : o.completed
            }
            onClick={() =>
              void submit(
                widget.kind === "poll"
                  ? {
                      type: "vote",
                      key: o.key,
                      vote: o.voters.has(account.userId) ? -1 : 1,
                    }
                  : { type: "strike", key: o.key },
              )
            }
          >
            {widget.kind === "todo" ? (o.completed ? "☑ " : "☐ ") : ""}
            {o.label}
            {widget.kind === "poll" ? ` (${o.voters.size})` : ""}
          </button>
          {o.description && <p>{o.description}</p>}
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!option.trim() || widget.nextIndex > 1000) return;
          void submit(
            widget.kind === "poll"
              ? {
                  type: "new_option",
                  idx: widget.nextIndex,
                  option: option.trim(),
                }
              : {
                  type: "new_task",
                  key: widget.nextIndex,
                  task: option.trim(),
                  desc: "",
                  completed: false,
                },
          );
        }}
      >
        <label>
          {widget.kind === "poll" ? "New poll option" : "New task"}
          <input
            value={option}
            onChange={(e) => setOption(e.target.value)}
            maxLength={1000}
          />
        </label>
        <button disabled={busy || !option.trim() || widget.nextIndex > 1000}>
          Add
        </button>
      </form>
      {message.sender_id === account.userId && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim())
              void submit(
                widget.kind === "poll"
                  ? { type: "question", question: title.trim() }
                  : { type: "new_task_list_title", title: title.trim() },
              );
          }}
        >
          <label>
            Edit {widget.kind === "poll" ? "question" : "list title"}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={1000}
            />
          </label>
          <button disabled={busy || !title.trim()}>Update title</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Updating…</p>}
    </section>
  );
}
