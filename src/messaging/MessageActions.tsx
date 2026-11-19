import { ReminderForm } from "./ReminderForm";
import { messagingCapabilities } from "./capabilities";
import { useEffect, useRef, useState } from "react";
import { request } from "../api";
import { getCache } from "../cache";
import { MessageContent } from "../components/MessageContent";
import type { Account, Message } from "../types";
import { messageLink } from "./actions";
type History = {
  timestamp: number;
  user_id: number;
  content: string;
  rendered_content?: string;
  topic?: string;
};
export function MessageActions({
  account,
  message,
  canDelete,
  onQuote,
  onError,
}: {
  account: Account;
  message: Message;
  canDelete: boolean;
  onQuote: (message: Message, raw: string) => void;
  onError: (error: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [history, setHistory] = useState<History[] | null>(null),
    [status, setStatus] = useState("");
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    const reset = (e: Event) => {
      if ((e as CustomEvent).detail.accountId === account.id) {
        controller.current.abort();
        setOpen(false);
        setHistory(null);
      }
    };
    const events = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (
        d.accountId === account.id &&
        d.events.some(
          (e: { type: string; message_id: number }) =>
            e.type === "update_message" && e.message_id === message.id,
        )
      )
        setHistory(null);
    };
    window.addEventListener("zoomerlip-messaging-reset", reset);
    window.addEventListener("zoomerlip-messaging", events);
    return () => {
      controller.current.abort();
      window.removeEventListener("zoomerlip-messaging-reset", reset);
      window.removeEventListener("zoomerlip-messaging", events);
    };
  }, [account.id, message.id]);
  async function run(action: () => Promise<void>) {
    if (busy || controller.current.signal.aborted) return;
    setBusy(true);
    setStatus("");
    try {
      await action();
    } catch (e) {
      if (!controller.current.signal.aborted)
        onError(e instanceof Error ? e.message : "Message action failed.");
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  async function flag(flag: string, op: string) {
    const result = await request<{
      ignored_because_not_subscribed_channels?: number[];
    }>(
      account,
      "/messages/flags",
      { messages: [message.id], flag, op },
      "POST",
      controller.current.signal,
    );
    if (
      flag === "read" &&
      op === "remove" &&
      message.stream_id !== undefined &&
      result.ignored_because_not_subscribed_channels?.includes(
        message.stream_id,
      )
    )
      throw new Error("Join this channel before marking its messages unread.");
    if (!controller.current.signal.aborted) {
      getCache(account).events([
        {
          id: -1,
          type: "update_message_flags",
          messages: [message.id],
          flag,
          op,
        },
      ]);
      setStatus(
        flag === "read"
          ? "Marked unread."
          : op === "add"
            ? "Starred."
            : "Unstarred.",
      );
    }
  }
  return (
    <div className="messaging-extra-actions">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Message tools
      </button>
      {open && (
        <section
          className="messaging-panel"
          aria-label="Message tools"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <div className="messaging-tools">
            <button
              disabled={busy}
              aria-pressed={message.flags?.includes("starred") || false}
              onClick={() =>
                void run(() =>
                  flag(
                    "starred",
                    message.flags?.includes("starred") ? "remove" : "add",
                  ),
                )
              }
            >
              {message.flags?.includes("starred") ? "Unstar" : "Star"}
            </button>
            <button
              disabled={
                busy || messagingCapabilities(account.id).featureLevel < 121
              }
              onClick={() => void run(() => flag("read", "remove"))}
            >
              Mark unread
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const d = await request<{ message: Message }>(
                    account,
                    `/messages/${message.id}`,
                    { apply_markdown: false },
                    "GET",
                    controller.current.signal,
                  );
                  if (!controller.current.signal.aborted)
                    onQuote(message, d.message.content);
                })
              }
            >
              Quote reply
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const d = await request<{ message_history: History[] }>(
                    account,
                    `/messages/${message.id}/history`,
                    {},
                    "GET",
                    controller.current.signal,
                  );
                  if (
                    !Array.isArray(d.message_history) ||
                    d.message_history.length > 1000
                  )
                    throw new Error(
                      "Edit history exceeds this client's limit.",
                    );
                  if (!controller.current.signal.aborted)
                    setHistory(d.message_history);
                })
              }
            >
              Edit history
            </button>
            <button
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(
                    messageLink(account, message),
                  );
                  if (!controller.current.signal.aborted)
                    setStatus("Link copied.");
                })
              }
            >
              Copy permanent link
            </button>
            {canDelete && (
              <button disabled={busy} onClick={() => setConfirm(true)}>
                Delete message
              </button>
            )}
          </div>
          <label>
            Permanent link
            <input
              readOnly
              value={messageLink(account, message)}
              onFocus={(e) => e.target.select()}
            />
          </label>
          {confirm && (
            <div role="group" aria-label="Confirm message deletion">
              <p>
                Permanently delete this message for everyone? This cannot be
                undone. Organization permissions and time limits apply.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await request(
                      account,
                      `/messages/${message.id}`,
                      {},
                      "DELETE",
                      controller.current.signal,
                    );
                    if (!controller.current.signal.aborted)
                      getCache(account).events([
                        {
                          id: -1,
                          type: "delete_message",
                          message_id: message.id,
                        },
                      ]);
                  })
                }
              >
                Confirm delete
              </button>
              <button onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          )}
          <p role="status">{busy ? "Working…" : status}</p>
          {messagingCapabilities(account.id).featureLevel < 121 && (
            <p>Mark unread requires feature level 121.</p>
          )}
          <ReminderForm account={account} messageId={message.id} />
          {history && (
            <section aria-label="Edit history">
              {!history.length && <p>No edit history.</p>}
              {history.map((h, i) => (
                <article key={i}>
                  <small>
                    {new Date(h.timestamp * 1000).toLocaleString()} · User{" "}
                    {h.user_id} · {h.topic}
                  </small>
                  {h.rendered_content ? (
                    <MessageContent
                      account={account}
                      html={h.rendered_content}
                    />
                  ) : (
                    <p>{h.content}</p>
                  )}
                </article>
              ))}
            </section>
          )}
        </section>
      )}
    </div>
  );
}
