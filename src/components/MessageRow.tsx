import { MessageActions } from "../messaging/MessageActions";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronRight,
  MessageCircle,
  Pencil,
  Reply,
  SmilePlus,
  X,
  MoreHorizontal,
} from "lucide-react";
import { request } from "../api";
import { sendsOnEnter, touchPrimary } from "../composerKeys";
import type { Account, Message, Reaction, View } from "../types";
import { Avatar } from "./Avatar";
import { MessageContent } from "./MessageContent";
const choices = [
  ["1f44d", "+1", "👍", "thumbs up"],
  ["2764", "heart", "❤️", "heart"],
  ["1f389", "tada", "🎉", "celebration"],
  ["1f440", "eyes", "👀", "eyes"],
  ["1f680", "rocket", "🚀", "rocket"],
  ["1f602", "joy", "😂", "laughing"],
] as const;
function emojiDisplay(reaction: Reaction) {
  if (reaction.reaction_type !== "unicode_emoji")
    return `:${reaction.emoji_name}:`;
  try {
    return String.fromCodePoint(
      ...reaction.emoji_code.split("-").map((c) => parseInt(c, 16)),
    );
  } catch {
    return `:${reaction.emoji_name}:`;
  }
}
export const MessageRow = memo(function MessageRow({
  account,
  message,
  previous,
  view,
  active,
  onFocus,
  onSelect,
  onReply,
  onQuote,
  canDelete = false,
  onError,
}: {
  account: Account;
  message: Message;
  previous?: Message;
  view: View;
  active: boolean;
  onFocus: (id: number) => void;
  onSelect: (view: View) => void;
  onReply: (message: Message) => void;
  onQuote: (message: Message, raw: string) => void;
  canDelete?: boolean;
  onError: (error: string) => void;
}) {
  const [picker, setPicker] = useState(false),
    [editing, setEditing] = useState(false),
    [editText, setEditText] = useState(""),
    [original, setOriginal] = useState(""),
    [saving, setSaving] = useState(false),
    [touchActions, setTouchActions] = useState(false);
  const article = useRef<HTMLElement>(null),
    pickerRef = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    editRef = useRef<HTMLTextAreaElement>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (!picker) return;
    const element = pickerRef.current!,
      row = article.current!;
    const scroller = row.closest<HTMLElement>(".message-scroll");
    const fit = () => {
      if (!scroller) return;
      const pane = scroller.getBoundingClientRect();
      const anchor = row.getBoundingClientRect();
      element.style.maxHeight = `${Math.max(48, pane.height - 16)}px`;
      element.style.overflowY = "auto";
      const height = element.getBoundingClientRect().height;
      const top = Math.max(
        pane.top + 8,
        Math.min(anchor.top + 20, pane.bottom - height - 8),
      );
      element.style.top = `${top - anchor.top}px`;
    };
    fit();
    element
      .querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    scroller?.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    return () => {
      scroller?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, [picker]);
  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);
  useEffect(() => {
    article.current
      ?.querySelectorAll<HTMLElement>("button,a[href],textarea,input")
      .forEach((el) => {
        el.tabIndex = active ? 0 : -1;
      });
  }, [active, message, picker, editing, touchActions]);
  const newDay =
    !previous ||
    new Date(previous.timestamp * 1000).toDateString() !==
      new Date(message.timestamp * 1000).toDateString();
  const grouped =
    previous &&
    !newDay &&
    previous.sender_id === message.sender_id &&
    previous.subject === message.subject &&
    message.timestamp - previous.timestamp < 300;
  const reactions = useMemo(() => {
    const groups = new Map<string, Reaction[]>();
    for (const reaction of message.reactions) {
      const key = `${reaction.reaction_type}:${reaction.emoji_code}`;
      const group = groups.get(key);
      if (group) group.push(reaction);
      else groups.set(key, [reaction]);
    }
    return groups;
  }, [message.reactions]);
  function closePicker() {
    setPicker(false);
    trigger.current?.focus();
  }
  async function react(
    reaction: Pick<Reaction, "emoji_name" | "emoji_code" | "reaction_type">,
  ) {
    closePicker();
    const mine = message.reactions.some(
      (r) =>
        r.user_id === account.userId &&
        r.emoji_code === reaction.emoji_code &&
        r.reaction_type === reaction.reaction_type,
    );
    try {
      await request(
        account,
        `/messages/${message.id}/reactions`,
        reaction,
        mine ? "DELETE" : "POST",
      );
    } catch (error) {
      if (alive.current)
        onError(error instanceof Error ? error.message : "Reaction failed.");
    }
  }
  async function edit() {
    try {
      const data = await request<{ message: Message }>(
        account,
        `/messages/${message.id}`,
        { apply_markdown: false },
      );
      if (!alive.current) return;
      setOriginal(data.message.content);
      setEditText(data.message.content);
      setEditing(true);
    } catch (error) {
      if (alive.current)
        onError(
          error instanceof Error ? error.message : "Could not edit message.",
        );
    }
  }
  async function save() {
    if (saving) return;
    if (editText === original) {
      setEditing(false);
      article.current?.focus();
      return;
    }
    if (!editText.trim()) return;
    setSaving(true);
    try {
      await request(
        account,
        `/messages/${message.id}`,
        { content: editText },
        "PATCH",
      );
      if (alive.current) {
        setEditing(false);
        article.current?.focus();
      }
    } catch (error) {
      if (alive.current)
        onError(error instanceof Error ? error.message : "Edit failed.");
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  return (
    <div>
      {newDay && (
        <div className="date-divider">
          <span>
            {new Date(message.timestamp * 1000).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
      )}
      {view.type === "channel" &&
        view.topic === undefined &&
        (!previous || previous.subject !== message.subject) && (
          <button
            className="thread-divider"
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect({ ...view, topic: message.subject })}
          >
            <MessageCircle size={14} />
            {message.subject || "(no topic)"}
            <ChevronRight size={14} />
          </button>
        )}
      <article
        ref={article}
        data-message-id={message.id}
        tabIndex={active ? 0 : -1}
        className={`message ${grouped ? "grouped" : ""} ${touchActions ? "show-actions" : ""}`}
        aria-label={`Message from ${message.sender_full_name}`}
        onFocus={() => onFocus(message.id)}
      >
        {!grouped ? (
          <Avatar
            name={message.sender_full_name}
            url={message.avatar_url}
            org={account.url}
          />
        ) : (
          <time className="group-time">
            {new Date(message.timestamp * 1000).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        )}
        <div className="message-body">
          {!grouped && (
            <div className="message-meta">
              <button
                onClick={() =>
                  onSelect({
                    type: "profile",
                    userId: message.sender_id,
                    posts: "channels",
                  })
                }
              >
                {message.sender_full_name}
              </button>
              <time dateTime={new Date(message.timestamp * 1000).toISOString()}>
                {new Date(message.timestamp * 1000).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
          )}
          {editing ? (
            <form
              className="edit-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <textarea
                ref={editRef}
                aria-label="Edit message"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditing(false);
                    article.current?.focus();
                  } else if (
                    sendsOnEnter(
                      { ...e, isComposing: e.nativeEvent.isComposing },
                      touchPrimary(),
                    )
                  ) {
                    e.preventDefault();
                    void save();
                  }
                }}
                required
              />
              <button
                className="icon-button"
                aria-label="Save edit"
                disabled={saving || !editText.trim()}
              >
                <Check size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Cancel edit"
                onClick={() => {
                  setEditing(false);
                  article.current?.focus();
                }}
              >
                <X size={18} />
              </button>
            </form>
          ) : (
            <MessageContent
              html={message.rendered_content || message.content}
              account={account}
            />
          )}
          <MessageActions
            account={account}
            message={message}
            canDelete={canDelete || message.sender_id === account.userId}
            onQuote={onQuote}
            onError={onError}
          />
          {!!reactions.size && (
            <div className="reactions">
              {[...reactions].map(([key, group]) => (
                <button
                  key={key}
                  aria-label={`${group[0].emoji_name}: ${group.length} reactions`}
                  aria-pressed={group.some((r) => r.user_id === account.userId)}
                  className={
                    group.some((r) => r.user_id === account.userId)
                      ? "mine"
                      : ""
                  }
                  onClick={() => void react(group[0])}
                >
                  {emojiDisplay(group[0])}
                  <span>{group.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="touch-actions icon-button"
          aria-label="Message actions"
          aria-expanded={touchActions}
          onClick={() => setTouchActions(!touchActions)}
        >
          <MoreHorizontal size={18} />
        </button>
        <div className="message-actions">
          <button
            ref={trigger}
            className="icon-button"
            aria-label="Add reaction"
            title="Add reaction"
            aria-expanded={picker}
            onClick={() => (picker ? closePicker() : setPicker(true))}
          >
            <SmilePlus size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Reply"
            title="Reply"
            onClick={() => onReply(message)}
          >
            <Reply size={17} />
          </button>
          {message.sender_id === account.userId && (
            <button
              className="icon-button"
              aria-label="Edit message"
              title="Edit message"
              onClick={() => void edit()}
            >
              <Pencil size={16} />
            </button>
          )}
        </div>
        {picker && (
          <div
            ref={pickerRef}
            className="emoji-picker"
            role="group"
            aria-label="Choose reaction"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                closePicker();
              }
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const buttons = [
                  ...pickerRef.current!.querySelectorAll("button"),
                ];
                const index = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                buttons[
                  (index + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) %
                    buttons.length
                ]?.focus();
              }
            }}
          >
            {choices.map(([code, name, glyph, label]) => (
              <button
                key={code}
                aria-label={label}
                onClick={() =>
                  void react({
                    emoji_name: name,
                    emoji_code: code,
                    reaction_type: "unicode_emoji",
                  })
                }
              >
                {glyph}
              </button>
            ))}
            <button aria-label="Close reactions" onClick={closePicker}>
              ×
            </button>
          </div>
        )}
      </article>
    </div>
  );
});
