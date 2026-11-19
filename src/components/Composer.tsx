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
import { useTyping } from "../live/typing";
import { request } from "../api";
import { sendsOnEnter, touchPrimary } from "../composerKeys";
import type { Account, Message, View } from "../types";
export type ComposerHandle = {
  reply: (message: Message) => void;
  focus: () => void;
};
type ChatView = Extract<View, { type: "channel" | "dm" }>;
type Draft = { text: string; topic: string };
export const Composer = memo(
  forwardRef<
    ComposerHandle,
    {
      account: Account;
      view: ChatView;
      title: string;
      privateChannel: boolean;
      saved: Draft;
      onSent: (topic: string) => void;
      onError: (error: string) => void;
    }
  >(function Composer(
    { account, view, title, privateChannel, saved, onSent, onError },
    ref,
  ) {
    const [text, setText] = useState(saved.text),
      [topic, setTopic] = useState(saved.topic),
      [sending, setSending] = useState(false);
    const input = useRef<HTMLTextAreaElement>(null),
      alive = useRef(true),
      busy = useRef(false);
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
      return () => {
        alive.current = false;
      };
    }, []);
    useImperativeHandle(
      ref,
      () => ({
        focus: () => input.current?.focus(),
        reply: (message) => {
          setText((current) => {
            const next = `${current}${current ? "\n" : ""}@_**${message.sender_full_name}|${message.sender_id}** `;
            saved.text = next;
            return next;
          });
          if (view.type === "channel" && !view.topic) {
            setTopic(message.subject);
            saved.topic = message.subject;
          }
          input.current?.focus();
        },
      }),
      [saved, view],
    );
    async function send() {
      if (!text.trim() || busy.current) return;
      if (view.type === "channel" && (!topic.trim() || topic.length > 60)) {
        onError(
          topic.length > 60
            ? "Thread topics must be at most 60 characters."
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
        );
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
      <div className="compose-area">
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
                aria-invalid={topic.length > 60}
                placeholder="Give this thread a topic…"
                value={topic}
                onChange={(e) => {
                  setTopic(e.target.value);
                  saved.topic = e.target.value;
                }}
                readOnly={!!view.topic}
              />
              <small
                id="topic-length"
                className={topic.length > 60 ? "error" : ""}
              >
                {topic.length}/60
              </small>
            </label>
          )}
          <div className="compose-row">
            <textarea
              ref={input}
              id="message-composer"
              aria-label="Message"
              rows={1}
              enterKeyHint={touch ? "enter" : "send"}
              placeholder={`Message ${view.type === "channel" ? "#" : "@"}${title}`}
              value={text}
              onBlur={() => typing.stop()}
              onChange={(e) => {
                setText(e.target.value);
                saved.text = e.target.value;
                if (e.target.value.trim()) typing.input();
                else typing.stop();
              }}
              onKeyDown={(event) => {
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
                !text.trim() ||
                (view.type === "channel" && topic.length > 60)
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
