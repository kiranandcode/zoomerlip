import { ArrowLeft, MessageCircle, Hash, UserRound } from "lucide-react";
import { Avatar } from "./Avatar";
import { MessageContent } from "./MessageContent";
import type { Account, Message, User, View } from "../types";
export function ProfilePage({
  account,
  user,
  userId,
  messages,
  loading,
  hasOlder,
  olderBusy,
  older,
  hasNewer,
  newerBusy,
  newer,
  scope,
  setScope,
  onSelect,
}: {
  account: Account;
  user?: User;
  userId: number;
  messages: Message[];
  loading: boolean;
  hasOlder: boolean;
  olderBusy: boolean;
  older: () => Promise<void>;
  hasNewer: boolean;
  newerBusy: boolean;
  newer: () => Promise<void>;
  scope: "channels" | "all";
  setScope: (scope: "channels" | "all") => void;
  onSelect: (view: View) => void;
}) {
  const own = userId === account.userId,
    name = user?.full_name || (own ? account.email : "Member");
  const threads = new Set(
    messages
      .filter((m) => m.type === "stream")
      .map((m) => `${m.stream_id}:${m.subject}`),
  );
  function open(message: Message) {
    if (message.type === "stream" && message.stream_id)
      onSelect({
        type: "channel",
        channelId: message.stream_id,
        topic: message.subject,
      });
    else if (Array.isArray(message.display_recipient)) {
      const ids = message.display_recipient
        .map((u) => u.id)
        .filter((id) => id !== account.userId);
      onSelect({ type: "dm", userIds: ids.length ? ids : [account.userId] });
    }
  }
  return (
    <section className="profile-page">
      <button
        className="profile-back"
        onClick={() => onSelect({ type: "home" })}
      >
        <ArrowLeft size={15} />
        Conversations
      </button>
      <div className="profile-cover">
        <span className="profile-cover-mark">Z.</span>
      </div>
      <div className="profile-summary">
        <Avatar name={name} url={user?.avatar_url} org={account.url} />
        <div className="profile-actions">
          {!own && (
            <button
              className="primary"
              onClick={() => onSelect({ type: "dm", userIds: [userId] })}
            >
              <MessageCircle size={16} />
              Message
            </button>
          )}
          <span className="profile-tag">
            {own ? "YOUR PROFILE" : user?.is_bot ? "BOT" : "MEMBER"}
          </span>
        </div>
        <h1>{name}</h1>
        <p>
          {user?.email && !/user\d+@/.test(user.email)
            ? user.email
            : own
              ? account.email
              : `Member of ${account.name}`}
        </p>
        <div className="profile-facts">
          {user?.date_joined && (
            <span>
              Joined{" "}
              {new Date(user.date_joined).toLocaleDateString(undefined, {
                month: "long",
                year: "numeric",
              })}
            </span>
          )}
          {user?.timezone && <span>{user.timezone}</span>}
          <span>{messages.length} loaded posts</span>
          <span>{threads.size} threads in this page</span>
        </div>
      </div>
      <div className="activity-heading">
        <div>
          <UserRound size={18} />
          <h2>{own ? "My posts" : "Recent posts"}</h2>
        </div>
        <div className="segmented">
          <button
            aria-pressed={scope === "channels"}
            onClick={() => setScope("channels")}
          >
            Channels
          </button>
          <button
            aria-pressed={scope === "all"}
            onClick={() => setScope("all")}
          >
            Include DMs
          </button>
        </div>
      </div>
      <p className="history-scope">
        {own
          ? "Your sent messages in this organisation."
          : "Messages in your accessible history."}{" "}
        {scope === "all"
          ? "Includes DMs you can access."
          : "Channel posts only."}
      </p>
      {loading && !messages.length && (
        <div className="empty-state">Loading posts…</div>
      )}
      {!loading && !messages.length && (
        <div className="empty-state">No posts found in this history.</div>
      )}
      {hasNewer && (
        <button
          className="load-older"
          disabled={newerBusy}
          onClick={() => void newer()}
        >
          {newerBusy ? "Loading…" : "Load newer posts"}
        </button>
      )}
      <div className="activity-feed">
        {[...messages].reverse().map((message) => (
          <article
            className="activity-card"
            key={message.id}
            data-message-id={message.id}
            aria-label={`Post by ${name}`}
          >
            <header>
              <button onClick={() => open(message)}>
                {message.type === "stream" ? (
                  <Hash size={15} />
                ) : (
                  <MessageCircle size={15} />
                )}
                <span>
                  {typeof message.display_recipient === "string"
                    ? message.display_recipient
                    : "Direct message"}
                </span>
                {message.subject && (
                  <>
                    <span className="activity-arrow">›</span>
                    <strong>{message.subject}</strong>
                  </>
                )}
              </button>
              <time>
                {new Date(message.timestamp * 1000).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </header>
            <MessageContent
              html={message.rendered_content || message.content}
              account={account}
            />
            <button className="open-conversation" onClick={() => open(message)}>
              Open conversation →
            </button>
          </article>
        ))}
      </div>
      {hasOlder && (
        <button
          className="load-older"
          disabled={olderBusy}
          onClick={() => void older()}
        >
          {olderBusy ? "Loading…" : "Load older posts"}
        </button>
      )}
    </section>
  );
}
