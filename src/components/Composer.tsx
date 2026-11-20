import { sendComposition } from "../messaging/send";
import { WidgetComposer } from "../messaging/WidgetComposer";
import { ProductivityPanel } from "../messaging/ProductivityPanel";
import type { ProductivityKind } from "../messaging/productivity";
import { quoteMessage } from "../messaging/actions";
import { useCompletion } from "../messaging/useCompletion";
import { Formatting } from "../messaging/Formatting";
import { ComposerMenu } from "../messaging/ComposerMenu";
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
import {
  Lock,
  MessageCircle,
  Send,
  Type,
  Paperclip,
  ListChecks,
  CalendarClock,
  StickyNote,
  Bell,
  FileText,
} from "lucide-react";
import { useTyping } from "../live/typing";
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
      [showWidget, setShowWidget] = useState(false),
      [showFormatting, setShowFormatting] = useState(false),
      [productivity, setProductivity] = useState<ProductivityKind | null>(null),
      [sending, setSending] = useState(false);
    const input = useRef<HTMLTextAreaElement>(null),
      alive = useRef(true),
      busy = useRef(false),
      operation = useRef(new AbortController()),
      lastSaved = useRef(initial?.text ?? saved.text),
      lastTopic = useRef(initial?.topic ?? saved.topic);
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
          lastTopic.current,
        );
        lastSaved.current = nextText;
        lastTopic.current = nextTopic;
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
          lastTopic.current = d.topic;
        }
        setShowDrafts(false);
        onSelect(d.view);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Restore failed.");
      }
    }
    const [touch] = useState(touchPrimary);
    const typing = useTyping(account, view, topic);
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
          setProductivity(null);
          saved.text = "";
        }
      };
      const sent = (e: Event) => {
        const d = (e as CustomEvent).detail;
        if (
          d.accountId === account.id &&
          d.destination === destinationKey(view)
        ) {
          if (saved.text === d.text) saved.text = "";
          setText((current) => (current === d.text ? "" : current));
          if (lastSaved.current === d.text) lastSaved.current = "";
        }
      };
      window.addEventListener("zoomerlip-draft-sent", sent);
      window.addEventListener("zoomerlip-messaging-reset", reset);
      return () => {
        operation.current.abort();
        window.removeEventListener("zoomerlip-messaging-reset", reset);
        window.removeEventListener("zoomerlip-draft-sent", sent);
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
      typing.stop();
      const sentText = text,
        sentTopic = topic.trim();
      busy.current = true;
      setSending(true);
      onError("");
      try {
        await sendComposition(account, view, sentText, sentTopic);
        if (saved.text === sentText) saved.text = "";
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
        <div className="compose-audience" id="compose-audience">
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
        {attachments.input}
        {showDrafts && (
          <DraftList
            account={account}
            onRestore={restore}
            onClose={() => setShowDrafts(false)}
          />
        )}
        {productivity && (
          <ProductivityPanel
            key={productivity}
            account={account}
            kind={productivity}
            view={view}
            text={text}
            topic={topic}
            onInsert={(value) =>
              changeText(`${saved.text}${saved.text ? "\n" : ""}${value}`)
            }
            onClose={() => setProductivity(null)}
          />
        )}
        {showWidget && (
          <WidgetComposer
            account={account}
            onClose={() => setShowWidget(false)}
            onCompose={(value) => {
              if (text.trim())
                saveDraft(account.id, {
                  id: crypto.randomUUID(),
                  view,
                  text,
                  topic,
                  updated: Date.now(),
                });
              changeText(value);
            }}
          />
        )}
        {attachments.status}
        {showFormatting && (
          <Formatting
            account={account}
            text={text}
            input={input}
            onChange={changeText}
          />
        )}
        {completion.list}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {view.type === "channel" && !view.topic && (
            <label className="topic-input">
              <MessageCircle size={14} />
              <input
                aria-label="Thread topic"
                aria-describedby="topic-length"
                aria-invalid={topic.length > limits.topicLength}
                placeholder="Topic"
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
            <ComposerMenu
              items={[
                {
                  label: "Attach file",
                  icon: Paperclip,
                  action: attachments.openPicker,
                },
                {
                  label: "Poll / to-do",
                  icon: ListChecks,
                  action: () => setShowWidget(!showWidget),
                },
                {
                  label: "Scheduled messages",
                  icon: CalendarClock,
                  action: () => setProductivity("scheduled_messages"),
                },
                {
                  label: "Snippets",
                  icon: StickyNote,
                  action: () => setProductivity("saved_snippets"),
                },
                {
                  label: "Reminders",
                  icon: Bell,
                  action: () => setProductivity("reminders"),
                },
                {
                  label: "Drafts",
                  icon: FileText,
                  action: () => setShowDrafts(!showDrafts),
                },
              ]}
            />
            <textarea
              ref={input}
              {...completion.props}
              id="message-composer"
              aria-label="Message"
              aria-describedby="compose-audience"
              rows={1}
              enterKeyHint={touch ? "enter" : "send"}
              placeholder={`Message ${view.type === "channel" ? "#" : "@"}${title}`}
              value={text}
              onBlur={() => typing.stop()}
              onPaste={(e) => {
                if (e.clipboardData.files.length) {
                  e.preventDefault();
                  attachments.add(e.clipboardData.files);
                }
              }}
              onChange={(e) => {
                changeText(e.target.value);
                if (e.target.value.trim()) typing.input();
                else typing.stop();
              }}
              onKeyDown={(event) => {
                if (
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229 ||
                  completion.keydown(event)
                )
                  return;
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
              type="button"
              className="composer-icon"
              aria-label="Formatting"
              title="Formatting"
              aria-expanded={showFormatting}
              onClick={() => setShowFormatting(!showFormatting)}
            >
              <Type size={20} />
            </button>
            <button
              className="send-button composer-icon"
              aria-label="Send message"
              title={
                touch
                  ? "Send message"
                  : "Send message (Enter; Shift+Enter for a new line)"
              }
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
      </div>
    );
  }),
);
