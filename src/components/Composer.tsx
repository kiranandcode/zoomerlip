import { quoteMessage } from "../messaging/actions";
import { useCompletion } from "../messaging/useCompletion";
import { Formatting } from "../messaging/Formatting";
import { useAttachments } from "../messaging/useAttachments";
import { messagingCapabilities } from "../messaging/capabilities";
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Lock, MessageCircle, Send } from "lucide-react";
import { DraftList } from "../messaging/DraftList";
import {
  destinationKey,
  draftFor,
  persistDraft,
  saveDraft,
} from "../messaging/drafts";
import type { Draft as StoredDraft } from "../messaging/drafts";
import { getCache } from "../cache";
import "../messaging/messaging.css";
import { request } from "../api";
import { sendsOnEnter, touchPrimary } from "../composerKeys";
import type { Account, Message, View, User } from "../types";
export type ComposerHandle = {
  reply: (message: Message) => void;
  quote: (message: Message, raw: string) => void;
  focus: () => void;
};
type ChatView = Extract<View, { type: "channel" | "dm" }>;
type Draft = { text: string; topic: string };
export const Composer = memo(
  forwardRef<
    ComposerHandle,
    {
      account: Account;
      users: User[];
      view: ChatView;
      title: string;
      privateChannel: boolean;
      saved: Draft;
      onSelect: (view: View) => void;
      onSent: (topic: string) => void;
      onError: (error: string) => void;
    }
  >(function Composer(
    {
      account,
      users,
      view,
      title,
      privateChannel,
      saved,
      onSelect,
      onSent,
      onError,
    },
    ref,
  ) {
    const [initial] = useState(() => {
      const d = draftFor(account.id, view);
      if (d) {
        saved.text = d.text;
        saved.topic = d.topic;
      }
      return d;
    });
    const [text, setText] = useState(initial?.text ?? saved.text),
      [topic, setTopic] = useState(initial?.topic ?? saved.topic),
      [showDrafts, setShowDrafts] = useState(false),
      [sending, setSending] = useState(false);
    const input = useRef<HTMLTextAreaElement>(null),
      alive = useRef(true),
      busy = useRef(false),
      operation = useRef(new AbortController()),
      lastSaved = useRef(initial?.text ?? saved.text);
    function persist(nextText: string, nextTopic: string) {
      if (operation.current.signal.aborted) return;
      saved.text = nextText;
      saved.topic = nextTopic;
      try {
        persistDraft(
          account.id,
          {
            id: destinationKey(view),
            view,
            text: nextText,
            topic: nextTopic,
            updated: Date.now(),
          },
          lastSaved.current,
        );
        lastSaved.current = nextText;
      } catch (e) {
        onError(
          e instanceof Error
            ? e.message
            : "Draft could not be saved on this device.",
        );
      }
    }
    function changeText(value: string) {
      setText(value);
      persist(value, topic);
    }
    const attachments = useAttachments(
      account,
      (value) => changeText(`${saved.text}${saved.text ? "\n" : ""}${value}`),
      onError,
    );
    const limits = messagingCapabilities(account.id);
    const completion = useCompletion(account, users, text, input, changeText);
    function restore(d: StoredDraft) {
      try {
        if (text.trim())
          saveDraft(account.id, {
            id: crypto.randomUUID(),
            view,
            text,
            topic,
            updated: Date.now(),
          });
        saveDraft(account.id, { ...d, id: destinationKey(d.view) });
        const target = getCache(account).ui(d.view);
        target.text = d.text;
        target.topic = d.topic;
        if (destinationKey(d.view) === destinationKey(view)) {
          setText(d.text);
          setTopic(d.topic);
          lastSaved.current = d.text;
        }
        setShowDrafts(false);
        onSelect(d.view);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Restore failed.");
      }
    }
    const [touch] = useState(touchPrimary);
    // Grow with the draft up to the CSS max-height; then the textarea scrolls.
    useLayoutEffect(() => {
      const el = input.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, [text]);
    useEffect(() => {
      alive.current = true;
      operation.current = new AbortController();
      const reset = (e: Event) => {
        const d = (e as CustomEvent).detail;
        if (
          d.accountId === account.id &&
          (!d.streams ||
            (view.type === "channel" && d.streams.includes(view.channelId)))
        ) {
          operation.current.abort();
          setText("");
          setShowDrafts(false);
          saved.text = "";
        }
      };
      window.addEventListener("zoomerlip-messaging-reset", reset);
      return () => {
        operation.current.abort();
        window.removeEventListener("zoomerlip-messaging-reset", reset);
        alive.current = false;
      };
    }, []);
    useImperativeHandle(
      ref,
      () => ({
        focus: () => input.current?.focus(),
        quote: (message, raw) => {
          const next = `${saved.text}${saved.text ? "\n" : ""}${quoteMessage(account, message, raw)}`;
          const targetTopic =
            view.type === "channel" && !view.topic ? message.subject : topic;
          setText(next);
          setTopic(targetTopic);
          persist(next, targetTopic);
          input.current?.focus();
        },
        reply: (message) => {
          setText((current) => {
            const next = `${current}${current ? "\n" : ""}@_**${message.sender_full_name}|${message.sender_id}** `;
            persist(
              next,
              view.type === "channel" && !view.topic ? message.subject : topic,
            );
            return next;
          });
          if (view.type === "channel" && !view.topic) {
            setTopic(message.subject);
            saved.topic = message.subject;
          }
          input.current?.focus();
        },
      }),
      [saved, view, topic],
    );
    async function send() {
      if (!text.trim() || busy.current || attachments.busy) return;
      if (text.length > limits.messageLength) {
        onError(`Message exceeds the ${limits.messageLength} character limit.`);
        return;
      }
      if (
        view.type === "channel" &&
        (!topic.trim() || topic.length > limits.topicLength)
      ) {
        onError(
          topic.length > limits.topicLength
            ? `Thread topics must be at most ${limits.topicLength} characters.`
            : "Give this thread a topic before sending.",
        );
        return;
      }
      const sentText = text,
        sentTopic = topic.trim();
      busy.current = true;
      setSending(true);
      onError("");
      try {
        await request(
          account,
          "/messages",
          view.type === "channel"
            ? {
                type: "stream",
                to: view.channelId,
                topic: sentTopic,
                content: sentText,
              }
            : { type: "private", to: view.userIds, content: sentText },
          "POST",
          operation.current.signal,
        );
        if (saved.text === sentText) persist("", sentTopic);
        if (!alive.current) return;
        setText((current) => (current === sentText ? "" : current));
        onSent(sentTopic);
      } catch (error) {
        if (alive.current)
          onError(
            `${error instanceof Error ? error.message : "Send failed."} Your draft is still here. Check for delivery before retrying.`,
          );
      } finally {
        busy.current = false;
        if (alive.current) setSending(false);
      }
    }
    return (
      <div
        className="compose-area"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            attachments.add(e.dataTransfer.files);
          }
        }}
      >
        <div className="compose-audience">
          {view.type === "channel" ? (
            <>
              {privateChannel && <Lock size={12} />}
              <span>
                {privateChannel
                  ? "Private channel · members only"
                  : "Public channel"}{" "}
                · {title}
              </span>
            </>
          ) : (
            <span>Direct message · {title}</span>
          )}
        </div>
        <div className="messaging-tools">
          {attachments.button}
          <button type="button" onClick={() => setShowDrafts(!showDrafts)}>
            Drafts
          </button>
        </div>
        {showDrafts && (
          <DraftList
            account={account}
            onRestore={restore}
            onClose={() => setShowDrafts(false)}
          />
        )}
        {attachments.status}
        <Formatting
          account={account}
          text={text}
          input={input}
          onChange={changeText}
        />
        {completion.list}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {view.type === "channel" && (
            <label className="topic-input">
              <MessageCircle size={14} />
              <input
                aria-label="Thread topic"
                aria-describedby="topic-length"
                aria-invalid={topic.length > limits.topicLength}
                placeholder="Give this thread a topic…"
                value={topic}
                onChange={(e) => {
                  setTopic(e.target.value);
                  persist(text, e.target.value);
                }}
                readOnly={!!view.topic}
              />
              <small
                id="topic-length"
                className={topic.length > limits.topicLength ? "error" : ""}
              >
                {topic.length}/{limits.topicLength}
              </small>
            </label>
          )}
          <div className="compose-row">
            <textarea
              ref={input}
              {...completion.props}
              id="message-composer"
              aria-label="Message"
              rows={1}
              enterKeyHint={touch ? "enter" : "send"}
              placeholder={`Message ${view.type === "channel" ? "#" : "@"}${title}`}
              value={text}
              onPaste={(e) => {
                if (e.clipboardData.files.length) {
                  e.preventDefault();
                  attachments.add(e.clipboardData.files);
                }
              }}
              onChange={(e) => {
                changeText(e.target.value);
              }}
              onKeyDown={(event) => {
                if (completion.keydown(event)) return;
                if (
                  sendsOnEnter(
                    { ...event, isComposing: event.nativeEvent.isComposing },
                    touch,
                  )
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="send-button"
              aria-label="Send message"
              disabled={
                sending ||
                attachments.busy ||
                text.length > limits.messageLength ||
                !text.trim() ||
                (view.type === "channel" && topic.length > limits.topicLength)
              }
            >
              <Send size={19} />
            </button>
          </div>
        </form>
        <div className="compose-hint">
          {touch ? (
            <span>
              <strong>Send</strong> to post · <strong>Enter</strong> for a new
              line
            </span>
          ) : (
            <span>
              <strong>Enter</strong> to send · <strong>Shift + Enter</strong>{" "}
              for a new line
            </span>
          )}
          <span>Markdown welcome</span>
        </div>
      </div>
    );
  }),
);
