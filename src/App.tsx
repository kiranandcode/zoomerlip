import {
  memo,
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
  Users,
  X,
  ArrowDown,
  UserRound,
  Palette,
  Lock,
} from "lucide-react";
import { clearCache, getCache } from "./cache";
import { useMessages } from "./useMessages";
import { Avatar, initials } from "./components/Avatar";
import { ProfilePage } from "./components/ProfilePage";
import { Appearance } from "./components/Appearance";
import { MemberList } from "./components/MemberList";
import { readAccounts, saveAccounts } from "./api";
import { useSession } from "./useSession";
import type { Session } from "./useSession";
import type { Account, Message, Topic, User, View } from "./types";
import { Login } from "./components/Login";
import { MessageRow } from "./components/MessageRow";
import { Composer } from "./components/Composer";
import type { ComposerHandle } from "./components/Composer";
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
  const logout = useCallback(() => {
    if (
      active &&
      window.confirm(
        `Remove ${active.name} and its saved API key from this browser?`,
      )
    )
      update(accounts.filter((a) => a.id !== active.id));
  }, [active, accounts]);
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
              aria-label={`Open ${sessions[a.id]?.name || a.name}${sessions[a.id]?.unread ? `, ${sessions[a.id].unread} unread` : ""}`}
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
          onLogout={logout}
        />
      </div>
      {storageError && (
        <div role="alert" className="toast">
          {storageError}
        </div>
      )}
      {adding && (
        <AddOrganization onClose={() => setAdding(false)} onLogin={onLogin} />
      )}
    </>
  );
}
function AddOrganization({
  onClose,
  onLogin,
}: {
  onClose: () => void;
  onLogin: (account: Account) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="add-org-dialog"
      aria-label="Add organization"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Login onLogin={onLogin} onClose={onClose} />
    </dialog>
  );
}
const emptyUsers: User[] = [];
const Workspace = memo(function Workspace({
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
    users = session?.users || emptyUsers;
  const userMap = useMemo(
    () => new Map(users.map((user) => [user.user_id, user])),
    [users],
  );
  const navToggle = useRef<HTMLButtonElement>(null);
  const navClose = useRef<HTMLButtonElement>(null);
  const closeNav = useCallback(() => {
    setShowNav(false);
    navToggle.current?.focus();
  }, []);
  useEffect(() => {
    if (!showNav) return;
    navClose.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeNav();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [showNav, closeNav]);
  const selectedChannel =
    view.type === "channel"
      ? channels.find((c) => c.stream_id === view.channelId)
      : undefined;
  useEffect(() => {
    const home = () => {
      setView({ type: "home" });
      setShowNav(false);
    };
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
  const me = userMap.get(account.userId);
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
            .map((id) => userMap.get(id)?.full_name || "Unknown user")
            .join(", ")
        : view.type === "profile"
          ? view.userId === account.userId
            ? "My posts"
            : userMap.get(view.userId)?.full_name || "Profile"
          : selectedChannel?.name || "Channel";
  return (
    <>
      {showNav && (
        <button
          className="nav-backdrop"
          aria-label="Close channel drawer"
          onClick={closeNav}
        />
      )}
      <aside
        id="channel-sidebar"
        className={`sidebar ${showNav ? "mobile-open" : ""}`}
      >
        <header className="org-header">
          <span className="org-name">
            {session?.name || account.name}
            <small role="status" aria-live="polite">
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
          <button
            ref={navClose}
            className="icon-button mobile-close"
            aria-label="Close channels"
            onClick={closeNav}
          >
            <X size={20} />
          </button>
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
                    aria-label={
                      channel.invite_only
                        ? `${channel.name} (private channel)`
                        : channel.name
                    }
                    onClick={() => {
                      select({ type: "channel", channelId: channel.stream_id });
                      setExpanded((ids) =>
                        ids.includes(channel.stream_id)
                          ? ids
                          : [...ids, channel.stream_id],
                      );
                    }}
                  >
                    {channel.invite_only ? (
                      <Lock size={18} />
                    ) : (
                      <Hash size={18} />
                    )}
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
            ref={navToggle}
            aria-expanded={showNav}
            aria-controls="channel-sidebar"
            onClick={() => setShowNav(!showNav)}
          >
            <Menu size={20} />
          </button>
          {view.type === "channel" ? (
            selectedChannel?.invite_only ? (
              <Lock className="header-hash" size={24} />
            ) : (
              <Hash className="header-hash" size={24} />
            )
          ) : (
            <AtSign className="header-hash" size={24} />
          )}
          <strong>{title}</strong>
          {view.type === "channel" && selectedChannel?.invite_only && (
            <span className="private-label">Private</span>
          )}
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
          privateChannel={!!selectedChannel?.invite_only}
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
});
const Conversation = memo(function Conversation({
  account,
  view,
  title,
  users,
  privateChannel,
  onSelect,
}: {
  account: Account;
  view: View;
  title: string;
  users: User[];
  privateChannel: boolean;
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
  const userMap = useMemo(
    () => new Map(users.map((user) => [user.user_id, user])),
    [users],
  );
  const [focusedMessage, setFocusedMessage] = useState<number | null>(null);
  const activeMessage = messages.some(
    (message) => message.id === focusedMessage,
  )
    ? focusedMessage
    : messages.at(-1)?.id;
  const scroller = useRef<HTMLDivElement>(null),
    composer = useRef<ComposerHandle>(null),
    atBottom = useRef(saved.atBottom),
    [newBelow, setNewBelow] = useState(false);
  const reply = useCallback(
    (message: Message) => composer.current?.reply(message),
    [],
  );
  const sent = useCallback(
    (topic: string) => {
      atBottom.current = true;
      if (
        view.type === "channel" &&
        view.topic !== undefined &&
        view.topic !== topic
      )
        onSelect({ ...view, topic });
    },
    [view, onSelect],
  );
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
      {view.type !== "home" && view.type !== "profile" && (
        <a
          className="skip-composer"
          href="#message-composer"
          onClick={(event) => {
            event.preventDefault();
            composer.current?.focus();
          }}
        >
          Skip to message composer
        </a>
      )}
      <div
        className="message-scroll"
        aria-label="Conversation history"
        onKeyDown={(event) => {
          if (
            !(event.target instanceof HTMLElement) ||
            !event.target.matches("article[data-message-id]") ||
            !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
          )
            return;
          event.preventDefault();
          const rows = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              "article[data-message-id]",
            ),
          ];
          const current = rows.indexOf(event.target);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? rows.length - 1
                : Math.max(
                    0,
                    Math.min(
                      rows.length - 1,
                      current + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
          rows[next]?.focus();
        }}

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
            user={userMap.get(view.userId)}
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
                    .map((id) => userMap.get(id)?.full_name || "Unknown user")
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
                        url={userMap.get(ids[0])?.avatar_url}
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
              messages.map((message, index) => (
                <MessageRow
                  key={message.id}
                  account={account}
                  message={message}
                  previous={messages[index - 1]}
                  view={view}
                  active={message.id === activeMessage}
                  onFocus={setFocusedMessage}
                  onSelect={onSelect}
                  onReply={reply}
                  onError={setError}
                />
              ))
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
        <Composer
          ref={composer}
          account={account}
          view={view}
          title={title}
          privateChannel={privateChannel}
          saved={saved}
          onSent={sent}
          onError={setError}
        />
      )}
    </>
  );
});
