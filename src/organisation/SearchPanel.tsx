import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Account, Channel, Message, View } from "../types";
import { MessageContent } from "../components/MessageContent";
import { request } from "../api";
import { getCache } from "../cache";
import {
  emptySearch,
  messageContext,
  SEARCH_LIMIT,
  searchMessages,
  messageView,
} from "./search";
import type { SearchFilters } from "./search";
import { useOrganisationRevision } from "./lifecycle";
export function SearchPanel({
  account,
  channels,
  featureLevel,
  special,
  onSelect,
  visibleMessage,
}: {
  account: Account;
  channels: Channel[];
  featureLevel: number;
  special?: "starred" | "mentioned" | "unread";
  visibleMessage?: (message: Message) => boolean;
  onSelect: (view: View) => void;
}) {
  const [filters, setFilters] = useState<SearchFilters>({
    ...emptySearch,
    special,
  });
  const [query, setQuery] = useState<SearchFilters>({
    ...emptySearch,
    special,
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [context, setContext] = useState<{
    view: View;
    messages: Message[];
    id: number;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [done, setDone] = useState(false),
    [trimmed, setTrimmed] = useState(false);
  const [unreadScope, setUnreadScope] = useState<"all" | "stream" | "private">(
    "all",
  );
  const cursor = useRef<number | undefined>(undefined),
    flight = useRef<AbortController | null>(null);
  const revision = useOrganisationRevision(account.id, "all", () =>
    flight.current?.abort(),
  );
  async function load(reset: boolean) {
    flight.current?.abort();
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    setError("");
    if (reset) {
      setMessages([]);
      setContext(null);
      cursor.current = undefined;
      setDone(false);
      setTrimmed(false);
    }
    try {
      const page = await searchMessages(
        account,
        query,
        reset ? undefined : cursor.current,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      cursor.current = page.cursor;
      setDone(page.done);
      setMessages((old) => {
        const next = reset ? page.messages : [...old, ...page.messages];
        if (next.length > SEARCH_LIMIT) setTrimmed(true);
        return next.slice(-SEARCH_LIMIT);
      });
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  useLayoutEffect(() => {
    void load(true);
    return () => flight.current?.abort();
  }, [query, revision, account]);
  async function open(message: Message) {
    flight.current?.abort();
    const controller = new AbortController();
    flight.current = controller;
    setContext(null);
    setBusy(true);
    setError("");
    try {
      if (special === "unread") {
        const latest = await request<{ message: Message }>(
          account,
          `/messages/${message.id}`,
          { apply_markdown: true },
          "GET",
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const view = messageView(latest.message, account.userId);
        const cache = getCache(account),
          ui = cache.ui(view);
        ui.anchorId = message.id;
        ui.anchorTop = 0;
        ui.atBottom = false;
        await cache.load(view, true, message.id);
        if (!controller.signal.aborted) {
          const error = cache.snapshot(view).error;
          if (error) throw new Error(error);
          onSelect(view);
        }
        return;
      }
      const result = await messageContext(
        account,
        message,
        featureLevel,
        controller.signal,
      );
      if (!controller.signal.aborted) setContext({ ...result, id: message.id });
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    if (context)
      document
        .querySelector<HTMLElement>(`[data-search-id="${context.id}"]`)
        ?.focus();
  }, [context]);
  const shownMessages =
    context?.messages ||
    messages.filter(
      (message) =>
        (!visibleMessage || visibleMessage(message)) &&
        (special !== "unread" ||
          unreadScope === "all" ||
          message.type === unreadScope),
    );
  return (
    <section
      className={`organisation-panel ${special === "unread" ? "unread-inbox" : ""}`}
      aria-label={special === "unread" ? "Unread messages" : "Message search"}
    >
      {special === "unread" ? (
        <div className="unread-toolbar">
          <div role="group" aria-label="Unread conversations">
            {(
              [
                ["all", "All"],
                ["stream", "Channels"],
                ["private", "DMs"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={unreadScope === value}
                onClick={() => setUnreadScope(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button disabled={busy} onClick={() => void load(true)}>
            Refresh
          </button>
        </div>
      ) : (
        <form
          className="organisation-form search-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery({ ...filters });
          }}
        >
          <label>
            Search text
            <input
              autoFocus
              aria-label="Search message text"
              value={filters.text}
              maxLength={1000}
              onChange={(e) => setFilters({ ...filters, text: e.target.value })}
            />
          </label>
          <label>
            Sender
            <input
              placeholder="Email or user ID"
              value={filters.sender}
              maxLength={1000}
              onChange={(e) =>
                setFilters({ ...filters, sender: e.target.value })
              }
            />
          </label>
          <label>
            Channel
            <select
              aria-label="Channel"
              value={filters.channel}
              onChange={(e) =>
                setFilters({ ...filters, channel: e.target.value })
              }
            >
              <option value="">All accessible channels</option>
              {channels.map((c) => (
                <option key={c.stream_id} value={c.stream_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Topic
            <input
              value={filters.topic}
              maxLength={1000}
              onChange={(e) =>
                setFilters({ ...filters, topic: e.target.value })
              }
            />
          </label>
          <label>
            After date
            <input
              type="date"
              value={filters.after}
              onChange={(e) =>
                setFilters({ ...filters, after: e.target.value })
              }
            />
          </label>
          <label>
            Before date
            <input
              type="date"
              value={filters.before}
              onChange={(e) =>
                setFilters({ ...filters, before: e.target.value })
              }
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={filters.attachment}
              onChange={(e) =>
                setFilters({ ...filters, attachment: e.target.checked })
              }
            />
            Has attachment
          </label>
          <button type="submit">Search messages</button>
        </form>
      )}
      {error && (
        <p role="alert">
          {error} <button onClick={() => void load(true)}>Retry search</button>
        </p>
      )}
      {busy && <p role="status">Loading messages…</p>}
      {context && (
        <div className="organisation-toolbar">
          <button onClick={() => setContext(null)}>Back to results</button>
          <button onClick={() => onSelect(context.view)}>
            Open conversation
          </button>
        </div>
      )}
      {trimmed && !context && (
        <p role="status">
          Showing the latest 200 loaded results. Search again to return to the
          newest matches.
        </p>
      )}
      {!busy && !shownMessages.length && (
        <p>
          {special === "unread"
            ? done
              ? "No unread messages here."
              : "No unread messages in this page. Load older messages below."
            : "No matching messages."}
        </p>
      )}
      <div
        className="search-results"
        aria-label={context ? "Result in context" : "Search results"}
        onKeyDown={(e) => {
          if (
            !(e.target instanceof HTMLElement) ||
            !e.target.matches("article") ||
            !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)
          )
            return;
          e.preventDefault();
          const rows = [
              ...e.currentTarget.querySelectorAll<HTMLElement>("article"),
            ],
            i = rows.indexOf(e.target);
          rows[
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? rows.length - 1
                : Math.max(
                    0,
                    Math.min(
                      rows.length - 1,
                      i + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  )
          ]?.focus();
        }}
      >
        {shownMessages.map((m) => (
          <article
            tabIndex={0}
            key={m.id}
            data-search-id={m.id}
            className={
              context?.id === m.id ? "search-result selected" : "search-result"
            }
          >
            <strong>{m.sender_full_name}</strong>
            <span>
              {" "}
              ·{" "}
              {typeof m.display_recipient === "string"
                ? m.display_recipient
                : "Direct message"}{" "}
              · {m.subject}
            </span>
            <time>{new Date(m.timestamp * 1000).toLocaleString()}</time>
            <MessageContent
              html={m.rendered_content || m.content}
              account={account}
            />
            {!context && (
              <button disabled={busy} onClick={() => void open(m)}>
                {special === "unread"
                  ? "Open conversation"
                  : `Open message ${m.id} in context`}
              </button>
            )}
          </article>
        ))}
      </div>
      {!context && !done && (
        <button disabled={busy} onClick={() => void load(false)}>
          Older results
        </button>
      )}
    </section>
  );
}
