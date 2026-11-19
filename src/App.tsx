import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AtSign,
  ChevronDown,
  ChevronRight,
  Hash,
  Home,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Send,
  SmilePlus,
  Users,
  X,
  Reply,
  Pencil,
  Check,
  ArrowDown,
  UserRound,
  Palette,
} from "lucide-react";
import { clearCache, getCache } from "./cache";
import { useMessages } from "./useMessages";
import { Avatar, initials } from "./components/Avatar";
import { ProfilePage } from "./components/ProfilePage";
import { Appearance } from "./components/Appearance";
import { MemberList } from "./components/MemberList";
import { readAccounts, request, saveAccounts } from "./api";
import { useSession } from "./useSession";
import type { Session } from "./useSession";
import type { Account, Message, Reaction, Topic, User, View } from "./types";
import { Login } from "./components/Login";
import { MessageContent } from "./components/MessageContent";
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong.";
function SessionBridge({
  account,
  active,
  report,
}: {
  account: Account;
  active: boolean;
  report: (id: string, state: Session) => void;
}) {
  const session = useSession(account, active);
  useEffect(() => {
    report(account.id, session);
  }, [account.id, session, report]);
  return null;
}
export default function App() {
  const [accounts, setAccounts] = useState(readAccounts);
  const [activeId, setActiveId] = useState(() => accounts[0]?.id);
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const [adding, setAdding] = useState(false),
    [storageError, setStorageError] = useState("");
  const report = useRef((id: string, state: Session) =>
    setSessions((s) => ({ ...s, [id]: state })),
  ).current;
  const active = accounts.find((a) => a.id === activeId) || accounts[0];
  function update(next: Account[]) {
    try {
      saveAccounts(next);
      accounts
        .filter((a) => !next.some((n) => n.id === a.id))
        .forEach((a) => clearCache(a.id));
      setAccounts(next);
      setStorageError("");
    } catch {
      setStorageError(
        "Browser storage is unavailable. Allow local storage to save your organizations.",
      );
      throw new Error("Could not save credentials.");
    }
  }
  function onLogin(account: Account) {
    update([...accounts.filter((a) => a.id !== account.id), account]);
    setActiveId(account.id);
    setAdding(false);
  }
  if (!active) return <Login onLogin={onLogin} />;
  return (
    <>
      <div className="app-shell">
        {accounts.map((a) => (
          <SessionBridge
            key={`${a.id}:${a.apiKey}`}
            account={a}
            active={a.id === active.id}
            report={report}
          />
        ))}
        <nav className="org-rail" aria-label="Organizations">
          <img className="brand" src="/logo.svg" alt="Zoomerlip" />
          <button
            className="rail-button home"
            title="Direct messages"
            aria-label="Direct messages"
            onClick={() => window.dispatchEvent(new Event("zoomerlip-home"))}
          >
            <Home size={23} />
          </button>
          <div className="rail-divider" />
          {accounts.map((a, i) => (
            <button
              key={a.id}
              title={sessions[a.id]?.name || a.name}
              aria-label={`Open ${sessions[a.id]?.name || a.name}`}
              aria-pressed={a.id === active.id}
              className={`rail-button org ${a.id === active.id ? "selected" : ""}`}
              style={
                { "--org-hue": String(150 + i * 75) } as React.CSSProperties
              }
              onClick={() => setActiveId(a.id)}
            >
              {initials(sessions[a.id]?.name || a.name)}
              {a.id !== active.id && !!sessions[a.id]?.unread && (
                <span className="badge">
                  {sessions[a.id].unread > 99 ? "99+" : sessions[a.id].unread}
                </span>
              )}
            </button>
          ))}
          <button
            className="rail-button add"
            aria-label="Add organization"
            title="Add organization"
            onClick={() => setAdding(true)}
          >
            <Plus size={25} />
          </button>
          <span className="rail-bottom">Z.</span>
        </nav>
        <Workspace
          key={active.id}
          account={active}
          session={sessions[active.id]}
          onLogout={() => {
            if (
              window.confirm(
                `Remove ${active.name} and its saved API key from this browser?`,
              )
            )
              update(accounts.filter((a) => a.id !== active.id));
          }}
        />
      </div>
      {storageError && (
        <div role="alert" className="toast">
          {storageError}
        </div>
      )}
      {adding && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="Add organization"
        >
          <Login onLogin={onLogin} onClose={() => setAdding(false)} />
        </div>
      )}
    </>
  );
}
function Workspace({
  account,
  session,
  onLogout,
}: {
  account: Account;
  session?: Session;
  onLogout: () => void;
}) {
  const cache = getCache(account);
  const topicVersion = useSyncExternalStore(
    cache.subscribeTopics,
    cache.topicSnapshot,
  );
  const [appearance, setAppearance] = useState(false);
  const [topicLimits, setTopicLimits] = useState<Record<number, number>>({});
  const [view, setView] = useState<View>({ type: "home" });
  const [expanded, setExpanded] = useState<number[]>([]),
    [topics, setTopics] = useState<Record<number, Topic[]>>({});
  const [filter, setFilter] = useState(""),
    [showMembers, setShowMembers] = useState(true),
    [showNav, setShowNav] = useState(false),
    [topicError, setTopicError] = useState("");
  const search = useDeferredValue(filter.toLowerCase());
  const channels = session?.channels || [],
    users = session?.users || [];
  const selectedChannel =
    view.type === "channel"
      ? channels.find((c) => c.stream_id === view.channelId)
      : undefined;
  useEffect(() => {
    const home = () => setView({ type: "home" });
    window.addEventListener("zoomerlip-home", home);
    return () => window.removeEventListener("zoomerlip-home", home);
  }, []);
  const expandedKey = expanded.join(",");
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(
      expanded.map(async (id) => {
        try {
          const cached = cache.peekTopics(id);
          if (cached) setTopics((t) => ({ ...t, [id]: cached }));
          const loaded = await cache.topics(id);
          if (!controller.signal.aborted)
            setTopics((t) => ({ ...t, [id]: loaded }));
          setTopicError("");
        } catch (e) {
          if (!controller.signal.aborted) setTopicError(errorText(e));
        }
      }),
    );
    return () => controller.abort();
    // The stable key avoids refetching on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, expandedKey, topicVersion]);
  const select = useCallback((next: View) => {
    setView(next);
    setShowNav(false);
  }, []);
  const me = users.find((u) => u.user_id === account.userId);
  const members = useMemo(
    () =>
      users
        .filter((u) => u.is_active && !u.is_bot)
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [users],
  );
  const visiblePeople = useMemo(
    () =>
      members.filter(
        (u) =>
          u.user_id !== account.userId &&
          u.full_name.toLowerCase().includes(search),
      ),
    [members, search, account.userId],
  );
  const title =
    view.type === "home"
      ? "Direct messages"
      : view.type === "dm"
        ? view.userIds
            .map(
              (id) =>
                users.find((u) => u.user_id === id)?.full_name ||
                "Unknown user",
            )
            .join(", ")
        : view.type === "profile"
          ? view.userId === account.userId
            ? "My posts"
            : users.find((u) => u.user_id === view.userId)?.full_name ||
              "Profile"
          : selectedChannel?.name || "Channel";
  return (
    <>
      <aside className={`sidebar ${showNav ? "mobile-open" : ""}`}>
        <header className="org-header">
          <span className="org-name">
            {session?.name || account.name}
            <small>
              <i
                className={
                  session?.status === "Live"
                    ? "status-dot"
                    : "status-dot offline"
                }
              />
              {session?.status || "Connecting"}
            </small>
          </span>
          <ChevronDown size={18} />
        </header>
        <div className="nav-search">
          <Search size={15} />
          <input
            aria-label="Find channels or people"
            placeholder="Find a channel or person"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="nav-scroll">
          <button
            className={`nav-row inbox ${view.type === "home" || view.type === "dm" ? "active" : ""}`}
            onClick={() => select({ type: "home" })}
          >
            <MessageCircle size={18} />
            Direct messages
          </button>
          <button
            className={`nav-row my-posts ${view.type === "profile" && view.userId === account.userId ? "active" : ""}`}
            onClick={() =>
              select({
                type: "profile",
                userId: account.userId,
                posts: "channels",
              })
            }
          >
            <UserRound size={18} />
            My posts
          </button>
          <div className="section-label">
            YOUR CHANNELS <span>{channels.length}</span>
          </div>
          {channels
            .filter((c) => c.name.toLowerCase().includes(search))
            .map((channel) => (
              <div key={channel.stream_id}>
                <div
                  className={`channel-row ${view.type === "channel" && view.channelId === channel.stream_id ? "current" : ""}`}
                >
                  <button
                    className="expand"
                    aria-label={`${expanded.includes(channel.stream_id) ? "Collapse" : "Expand"} ${channel.name}`}
                    aria-expanded={expanded.includes(channel.stream_id)}
                    onClick={() =>
                      setExpanded((ids) =>
                        ids.includes(channel.stream_id)
                          ? ids.filter((id) => id !== channel.stream_id)
                          : [...ids, channel.stream_id],
                      )
                    }
                  >
                    {expanded.includes(channel.stream_id) ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </button>
                  <button
                    className="channel-name"
                    onClick={() => {
                      select({ type: "channel", channelId: channel.stream_id });
                      setExpanded((ids) =>
                        ids.includes(channel.stream_id)
                          ? ids
                          : [...ids, channel.stream_id],
                      );
                    }}
                  >
                    <Hash size={18} />
                    <span>{channel.name}</span>
                  </button>
                </div>
                {expanded.includes(channel.stream_id) && (
                  <div className="topics">
                    {!topics[channel.stream_id] && (
                      <small>Loading threads…</small>
                    )}
                    {topics[channel.stream_id]
                      ?.slice(0, topicLimits[channel.stream_id] || 20)
                      .map((topic) => (
                        <button
                          key={topic.name}
                          className={`topic ${view.type === "channel" && view.channelId === channel.stream_id && view.topic === topic.name ? "active" : ""}`}
                          onClick={() =>
                            select({
                              type: "channel",
                              channelId: channel.stream_id,
                              topic: topic.name,
                            })
                          }
                        >
                          <span>↳</span>
                          {topic.name || "(no topic)"}
                        </button>
                      ))}
                    {(topics[channel.stream_id]?.length || 0) >
                      (topicLimits[channel.stream_id] || 20) && (
                      <button
                        className="topic"
                        onClick={() =>
                          setTopicLimits((l) => ({
                            ...l,
                            [channel.stream_id]:
                              (l[channel.stream_id] || 20) + 40,
                          }))
                        }
                      >
                        Show more threads ({topics[channel.stream_id].length})
                      </button>
                    )}
                    <button
                      className="topic new-topic"
                      onClick={() =>
                        select({
                          type: "channel",
                          channelId: channel.stream_id,
                          topic: "",
                        })
                      }
                    >
                      <Plus size={13} />
                      New thread
                    </button>
                  </div>
                )}
              </div>
            ))}
          {session && channels.length === 0 && (
            <p className="nav-empty">
              No subscribed channels yet. Subscribe in Zulip to see them here.
            </p>
          )}
          {topicError && <p className="error">{topicError}</p>}
          <div className="section-label">
            PEOPLE <span>{members.length}</span>
          </div>
          {visiblePeople.slice(0, 40).map((user) => (
            <button
              key={user.user_id}
              className="person nav-row"
              onClick={() => select({ type: "dm", userIds: [user.user_id] })}
            >
              <Avatar
                small
                name={user.full_name}
                url={user.avatar_url}
                org={account.url}
              />
              <span>{user.full_name}</span>
            </button>
          ))}
          {visiblePeople.length > 40 && (
            <p className="nav-empty">
              Search to find more people ({visiblePeople.length}).
            </p>
          )}
        </div>
        <footer className="profile">
          <Avatar
            small
            name={me?.full_name || account.email}
            url={me?.avatar_url}
            org={account.url}
          />
          <button
            className="self-profile"
            aria-label="My profile"
            onClick={() =>
              select({
                type: "profile",
                userId: account.userId,
                posts: "channels",
              })
            }
          >
            {me?.full_name || account.email}
            <small>My profile</small>
          </button>
          <button
            className="icon-button"
            title="Appearance"
            aria-label="Appearance"
            onClick={() => setAppearance(true)}
          >
            <Palette size={17} />
          </button>
          <button
            className="icon-button"
            title="Remove organization"
            aria-label="Remove organization"
            onClick={onLogout}
          >
            <LogOut size={17} />
          </button>
        </footer>
      </aside>
      <main className="main-pane">
        <header className="conversation-header">
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle channels"
            onClick={() => setShowNav(!showNav)}
          >
            <Menu size={20} />
          </button>
          {view.type === "channel" ? (
            <Hash className="header-hash" size={24} />
          ) : (
            <AtSign className="header-hash" size={24} />
          )}
          <strong>{title}</strong>
          {view.type === "channel" && view.topic !== undefined ? (
            <>
              <span className="header-divider" />
              <span className="header-description">
                {view.topic || "New thread"}
              </span>
            </>
          ) : (
            <>
              <span className="header-divider" />
              <span className="header-description">
                {selectedChannel?.description ||
                  "Good conversations start here."}
              </span>
            </>
          )}
          <button
            className={`icon-button members-toggle ${showMembers ? "on" : ""}`}
            aria-label="Toggle member list"
            aria-pressed={showMembers}
            onClick={() => setShowMembers(!showMembers)}
          >
            <Users size={21} />
          </button>
        </header>
        {session?.error && (
          <div className="connection-error" role="status">
            {session.status}: {session.error}
            {session.status === "Sign in again" &&
              " — Remove this organization and add it again."}
          </div>
        )}
        <Conversation
          key={JSON.stringify(view)}
          account={account}
          view={view}
          title={title}
          users={users}
          onSelect={select}
        />
      </main>
      {appearance && <Appearance onClose={() => setAppearance(false)} />}
      {showMembers && (
        <aside className="members">
          <header>
            THE PEOPLE <span>{members.length}</span>
          </header>
          <p>A little community. A lot to say.</p>
          <MemberList members={members} account={account} onSelect={select} />
          <div className="members-note">
            <img src="/logo.svg" alt="" />
            <strong>
              Less noise.
              <br />
              More conversation.
            </strong>
            <p>Keep it together with threads.</p>
          </div>
        </aside>
      )}
    </>
  );
}
function Conversation({
  account,
  view,
  title,
  users,
  onSelect,
}: {
  account: Account;
  view: View;
  title: string;
  users: User[];
  onSelect: (view: View) => void;
}) {
  const {
    messages,
    loading,
    error: loadError,
    hasOlder,
    cache,
  } = useMessages(account, view);
  const [error, setError] = useState(""),
    [olderBusy, setOlderBusy] = useState(false);
  const saved = cache.ui(view);
  const [text, setText] = useState(saved.text),
    [topic, setTopic] = useState(saved.topic),
    [sending, setSending] = useState(false),
    [picker, setPicker] = useState<number | null>(null),
    [editing, setEditing] = useState<number | null>(null),
    [editText, setEditText] = useState("");
  const scroller = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    atBottom = useRef(saved.atBottom),
    [newBelow, setNewBelow] = useState(false);
  useEffect(() => {
    saved.text = text;
    saved.topic = topic;
  }, [saved, text, topic]);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = saved.scrollTop;
  }, [saved]);
  const lastMessage = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (view.type === "profile" || view.type === "home") return;
    const latest = messages.at(-1)?.id;
    if (atBottom.current)
      requestAnimationFrame(() =>
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight }),
      );
    else if (
      lastMessage.current !== undefined &&
      latest !== lastMessage.current
    )
      setNewBelow(true);
    lastMessage.current = latest;
  }, [messages, view.type]);
  async function older() {
    setOlderBusy(true);
    const el = scroller.current;
    const height = el?.scrollHeight || 0;
    try {
      await cache.older(view);
      if (view.type !== "profile")
        requestAnimationFrame(() => {
          if (el) el.scrollTop += el.scrollHeight - height;
        });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setOlderBusy(false);
    }
  }
  async function send() {
    if (
      !text.trim() ||
      sending ||
      view.type === "home" ||
      view.type === "profile"
    )
      return;
    if (view.type === "channel" && !topic.trim()) {
      setError("Give this thread a topic before sending.");
      return;
    }
    const sentText = text;
    setSending(true);
    setError("");
    try {
      await request(
        account,
        "/messages",
        view.type === "channel"
          ? {
              type: "stream",
              to: view.channelId,
              topic: topic.trim(),
              content: text,
            }
          : { type: "private", to: view.userIds, content: text },
        "POST",
      );
      if (saved.text === sentText) saved.text = "";
      setText((current) => (current === sentText ? "" : current));
      atBottom.current = true;
      if (
        view.type === "channel" &&
        view.topic !== undefined &&
        view.topic !== topic.trim()
      ) {
        onSelect({ ...view, topic: topic.trim() });
      }
    } catch (e) {
      setError(
        `${errorText(e)} Your draft is still here. Check for delivery before retrying.`,
      );
    } finally {
      setSending(false);
    }
  }
  async function react(
    message: Message,
    reaction: Pick<Reaction, "emoji_name" | "emoji_code" | "reaction_type">,
  ) {
    setPicker(null);
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
    } catch (e) {
      setError(errorText(e));
    }
  }
  const dms = new Map<string, { ids: number[]; message: Message }>();
  if (view.type === "home")
    for (const message of [...messages].reverse()) {
      if (!Array.isArray(message.display_recipient)) continue;
      const others = message.display_recipient
        .map((u) => u.id)
        .filter((id) => id !== account.userId)
        .sort((a, b) => a - b);
      const ids = others.length ? others : [account.userId],
        key = ids.join(",");
      if (!dms.has(key)) dms.set(key, { ids, message });
    }
  return (
    <>
      <div
        className="message-scroll"
        ref={scroller}
        onScroll={() => {
          const el = scroller.current!;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          saved.scrollTop = el.scrollTop;
          saved.atBottom = atBottom.current;
          if (atBottom.current) setNewBelow(false);
        }}
      >
        {view.type === "profile" ? (
          <ProfilePage
            account={account}
            user={users.find((u) => u.user_id === view.userId)}
            userId={view.userId}
            messages={messages}
            loading={loading}
            hasOlder={hasOlder}
            olderBusy={olderBusy}
            older={older}
            scope={view.posts}
            setScope={(scope) => onSelect({ ...view, posts: scope })}
            onSelect={onSelect}
          />
        ) : (
          <>
            <div className="conversation-intro">
              <div className="intro-icon">
                {view.type === "channel" ? (
                  <Hash size={32} />
                ) : (
                  <MessageCircle size={32} />
                )}
              </div>
              <span className="eyebrow">
                {view.type === "home"
                  ? "YOUR CORNER OF THE INTERNET"
                  : "YOU’RE IN GOOD COMPANY"}
              </span>
              <h1>
                {view.type === "home"
                  ? "Let’s talk."
                  : view.type === "channel" && view.topic
                    ? view.topic
                    : title}
              </h1>
              <p>
                {view.type === "home"
                  ? "Pick a conversation, or find someone in the member list."
                  : view.type === "channel"
                    ? "A place for ideas, questions, and everything in between."
                    : "Just you and your people."}
              </p>
            </div>
            {hasOlder && (
              <button
                className="load-older"
                disabled={olderBusy}
                onClick={() => void older()}
              >
                {olderBusy ? "Loading…" : "Load older messages"}
              </button>
            )}
            {loading && messages.length === 0 && (
              <div className="empty-state" role="status">
                Finding your conversations…
              </div>
            )}
            {!loading && messages.length === 0 && (
              <div className="empty-state">
                {view.type === "home"
                  ? "No direct messages yet. Say hello to someone."
                  : "It’s quiet here. Start the conversation."}
              </div>
            )}
            {view.type === "home" ? (
              <div className="dm-list">
                {[...dms].map(([key, { ids, message }]) => {
                  const name = ids
                    .map(
                      (id) =>
                        users.find((u) => u.user_id === id)?.full_name ||
                        "Unknown user",
                    )
                    .join(", ");
                  return (
                    <button
                      className="dm-card"
                      key={key}
                      onClick={() => onSelect({ type: "dm", userIds: ids })}
                    >
                      <Avatar
                        name={name}
                        org={account.url}
                        url={
                          users.find((u) => u.user_id === ids[0])?.avatar_url
                        }
                      />
                      <span>
                        <strong>{name}</strong>
                        <small>
                          Last message from {message.sender_full_name}
                        </small>
                      </span>
                      <time>
                        {new Date(
                          message.timestamp * 1000,
                        ).toLocaleDateString()}
                      </time>
                      <ChevronRight size={18} />
                    </button>
                  );
                })}
              </div>
            ) : (
              messages.map((message, index) => {
                const previous = messages[index - 1];
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
                const reactions = new Map<string, Reaction[]>();
                for (const reaction of message.reactions) {
                  const key = `${reaction.reaction_type}:${reaction.emoji_code}`;
                  reactions.set(key, [...(reactions.get(key) || []), reaction]);
                }
                return (
                  <div key={message.id}>
                    {newDay && (
                      <div className="date-divider">
                        <span>
                          {new Date(
                            message.timestamp * 1000,
                          ).toLocaleDateString(undefined, {
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
                          onClick={() =>
                            onSelect({ ...view, topic: message.subject })
                          }
                        >
                          <MessageCircle size={14} />
                          {message.subject || "(no topic)"}
                          <ChevronRight size={14} />
                        </button>
                      )}
                    <article
                      tabIndex={0}
                      className={`message ${grouped ? "grouped" : ""}`}
                      aria-label={`Message from ${message.sender_full_name}`}
                    >
                      {!grouped ? (
                        <Avatar
                          name={message.sender_full_name}
                          url={message.avatar_url}
                          org={account.url}
                        />
                      ) : (
                        <time className="group-time">
                          {new Date(
                            message.timestamp * 1000,
                          ).toLocaleTimeString([], {
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
                            <time
                              dateTime={new Date(
                                message.timestamp * 1000,
                              ).toISOString()}
                            >
                              {new Date(
                                message.timestamp * 1000,
                              ).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </time>
                          </div>
                        )}
                        {editing === message.id ? (
                          <form
                            className="edit-form"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              try {
                                await request(
                                  account,
                                  `/messages/${message.id}`,
                                  { content: editText },
                                  "PATCH",
                                );
                                setEditing(null);
                              } catch (e) {
                                setError(errorText(e));
                              }
                            }}
                          >
                            <textarea
                              aria-label="Edit message"
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              required
                            />
                            <button
                              className="icon-button"
                              aria-label="Save edit"
                            >
                              <Check size={18} />
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="Cancel edit"
                              onClick={() => setEditing(null)}
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
                        {!!reactions.size && (
                          <div className="reactions">
                            {[...reactions].map(([key, group]) => (
                              <button
                                key={key}
                                aria-label={`${group[0].emoji_name}: ${group.length} reactions`}
                                aria-pressed={group.some(
                                  (r) => r.user_id === account.userId,
                                )}
                                className={
                                  group.some(
                                    (r) => r.user_id === account.userId,
                                  )
                                    ? "mine"
                                    : ""
                                }
                                onClick={() => void react(message, group[0])}
                              >
                                {emojiDisplay(group[0])}
                                <span>{group.length}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="message-actions">
                        <button
                          className="icon-button"
                          aria-label="Add reaction"
                          title="Add reaction"
                          onClick={() =>
                            setPicker(picker === message.id ? null : message.id)
                          }
                        >
                          <SmilePlus size={17} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Reply"
                          title="Reply"
                          onClick={() => {
                            setText(
                              (t) =>
                                `${t}${t ? "\n" : ""}@_**${message.sender_full_name}|${message.sender_id}** `,
                            );
                            setTopic(message.subject);
                            composer.current?.focus();
                          }}
                        >
                          <Reply size={17} />
                        </button>
                        {message.sender_id === account.userId && (
                          <button
                            className="icon-button"
                            aria-label="Edit message"
                            title="Edit message"
                            onClick={async () => {
                              try {
                                const data = await request<{
                                  message: Message;
                                }>(account, `/messages/${message.id}`, {
                                  apply_markdown: false,
                                });
                                setEditText(data.message.content);
                                setEditing(message.id);
                              } catch (e) {
                                setError(errorText(e));
                              }
                            }}
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                      </div>
                      {picker === message.id && (
                        <div
                          className="emoji-picker"
                          role="group"
                          aria-label="Choose reaction"
                        >
                          {[
                            ["1f44d", "+1", "👍"],
                            ["2764", "heart", "❤️"],
                            ["1f389", "tada", "🎉"],
                            ["1f440", "eyes", "👀"],
                            ["1f680", "rocket", "🚀"],
                            ["1f602", "joy", "😂"],
                          ].map(([code, name, glyph]) => (
                            <button
                              key={code}
                              aria-label={name}
                              onClick={() =>
                                void react(message, {
                                  emoji_name: name,
                                  emoji_code: code,
                                  reaction_type: "unicode_emoji",
                                })
                              }
                            >
                              {glyph}
                            </button>
                          ))}
                          <button
                            aria-label="Close reactions"
                            onClick={() => setPicker(null)}
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </article>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
      {newBelow && (
        <button
          className="new-below"
          onClick={() => {
            scroller.current?.scrollTo({
              top: scroller.current.scrollHeight,
              behavior:
                document.documentElement.dataset.motion === "off" ||
                window.matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "instant"
                  : "smooth",
            });
            setNewBelow(false);
          }}
        >
          <ArrowDown size={14} />
          New messages
        </button>
      )}
      {(error || loadError) && (
        <div className="conversation-error" role="alert">
          {error || loadError}
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
          <button
            onClick={() => {
              setError("");
              void cache.load(view, true);
            }}
          >
            Reload
          </button>
        </div>
      )}
      {view.type !== "home" && view.type !== "profile" && (
        <div className="compose-area">
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {view.type === "channel" && (
              <label className="topic-input">
                <MessageCircle size={14} />
                <input
                  aria-label="Thread topic"
                  maxLength={60}
                  placeholder="Give this thread a topic…"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  readOnly={!!view.topic}
                />
              </label>
            )}
            <div className="compose-row">
              <textarea
                ref={composer}
                aria-label="Message"
                rows={1}
                placeholder={`Message ${view.type === "channel" ? "#" : "@"}${title}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button
                className="send-button"
                aria-label="Send message"
                disabled={sending || !text.trim()}
              >
                <Send size={19} />
              </button>
            </div>
          </form>
          <div className="compose-hint">
            <span>
              <strong>Enter</strong> to send · <strong>Shift + Enter</strong>{" "}
              for a new line
            </span>
            <span>Markdown welcome ✨</span>
          </div>
        </div>
      )}
    </>
  );
}
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
