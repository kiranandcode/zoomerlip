import { useNotificationNavigation } from "./notifications/navigation";
import { trackViewport } from "./viewport";
import type { NotificationTarget } from "./notifications/navigation";
import { destinationKey, draftFor, saveDraft } from "./messaging/drafts";
import type { Destination } from "./messaging/drafts";
import { quoteMessage } from "./messaging/actions";
import {
  lazy,
  Suspense,
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
  FileText,
  CalendarClock,
  Settings2,
  Compass,
  Star,
  Lock,
} from "lucide-react";
import {
  MessagingNavigation,
  messagingViews,
} from "./organisation/MessagingNavigation";
import { OrganisationPanel } from "./organisation/OrganisationPanel";
import { useAccess } from "./organisation/useAccess";
import { canTopic } from "./organisation/permissions";
import { TopicEditor } from "./organisation/TopicEditor";
import { SearchPanel } from "./organisation/SearchPanel";
import "./organisation/organisation.css";
import { clearCache, getCache } from "./cache";
import { useMessages } from "./useMessages";
import { useReadMessages } from "./useReadMessages";
import { Avatar, initials } from "./components/Avatar";
import { ProfilePage } from "./components/ProfilePage";
import { Appearance } from "./components/AppearanceLoader";
import { MemberList } from "./components/MemberList";
import { getFeatureLevel, readAccounts } from "./api";
import {
  putAccount,
  removeAccount,
  accountStorageEvent,
} from "./accountStorage";
import { topicKey, serverMutesTopic } from "./sessionModel";
import {
  currentThreadMutes,
  useThreadMutes,
  useThreadMuteVersion,
} from "./topicPreferences";
import { TopicMenu } from "./components/TopicMenu";
import { ChannelMenu } from "./components/ChannelMenu";
import type { ChannelMenuTarget } from "./components/ChannelMenu";
import type { TopicMenuTarget } from "./components/TopicMenu";
import { clearUploadCache } from "./uploads";
import type { RecentConversation } from "./types";
import { useSession } from "./useSession";
import type { Session } from "./useSession";
import type { Account, Message, Topic, User, View } from "./types";
import { Login } from "./components/Login";
import { MessageRow } from "./components/MessageRow";
import { PresenceStatus } from "./live/PresenceStatus";
import "./live/live.css";
import { TypingIndicator } from "./live/TypingIndicator";
import { Composer } from "./components/Composer";
import type { ComposerHandle } from "./components/Composer";
import { readingAnchor, restoreAnchor } from "./scrollAnchor";
import { ChannelNavRow, TopicNavRow } from "./components/NavigationRows";
import { orgLabel } from "./orgLabel";
import type { ReadingAnchor } from "./scrollAnchor";
const memberCollator = new Intl.Collator();
const ChannelDirectory = lazy(() =>
  import("./organisation/ChannelDirectory").then((module) => ({
    default: module.ChannelDirectory,
  })),
);
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
  useLayoutEffect(trackViewport, []);
  const muteVersion = useThreadMuteVersion();
  const [accounts, setAccounts] = useState(readAccounts);
  const [showNav, setShowNav] = useState(false);
  const [activeId, setActiveId] = useState(() => accounts[0]?.id);
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const [adding, setAdding] = useState(false),
    [storageError, setStorageError] = useState("");
  const report = useRef((id: string, state: Session) =>
    setSessions((s) => ({ ...s, [id]: state })),
  ).current;
  const notificationTarget = useNotificationNavigation(
    accounts,
    setActiveId,
    setStorageError,
  );
  const unreadCounts = useMemo(
    () =>
      Object.fromEntries(
        accounts.map((a) => {
          const session = sessions[a.id];
          if (!session) return [a.id, 0];
          const local = currentThreadMutes(a.id);
          const removed = Object.keys(local).reduce((sum, key) => {
            try {
              const [id, topic] = JSON.parse(key);
              return (
                sum +
                (serverMutesTopic(session, id, topic)
                  ? 0
                  : session.topicUnreads[key] || 0)
              );
            } catch {
              return sum;
            }
          }, 0);
          return [a.id, Math.max(0, session.unread - removed)];
        }),
      ),
    [accounts, sessions, muteVersion],
  );
  const active = accounts.find((a) => a.id === activeId) || accounts[0];
  const accountRef = useRef(accounts);
  accountRef.current = accounts;
  useEffect(() => {
    const sync = () => {
      const old = accountRef.current;
      const next = readAccounts().map(
        (a) =>
          old.find(
            (p) =>
              p.id === a.id && p.apiKey === a.apiKey && p.email === a.email,
          ) || a,
      );
      for (const a of old)
        if (!next.some((n) => n.id === a.id && n.apiKey === a.apiKey)) {
          getCache(a).lock();
          clearCache(a.id);
          clearUploadCache(a.id);
        }
      accountRef.current = next;
      setAccounts(next);
      setSessions((s) =>
        Object.fromEntries(
          Object.entries(s).filter(([id]) => next.some((a) => a.id === id)),
        ),
      );
    };
    const storage = (e: StorageEvent) => {
      if (accountStorageEvent(e)) sync();
    };
    window.addEventListener("storage", storage);
    window.addEventListener("zoomerlip-accounts", sync);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener("zoomerlip-accounts", sync);
    };
  }, []);
  function onLogin(account: Account) {
    try {
      putAccount(account);
      setStorageError("");
      setActiveId(account.id);
      setAdding(false);
    } catch {
      setStorageError(
        "Browser storage is unavailable. Could not save credentials.",
      );
      throw new Error("Could not save credentials.");
    }
  }
  const logout = useCallback(() => {
    if (
      !active ||
      !window.confirm(
        `Remove ${active.name} and its saved API key from this browser?`,
      )
    )
      return;
    getCache(active).lock();
    clearUploadCache(active.id);
    try {
      removeAccount(active.id);
      setStorageError("");
    } catch {
      setAccounts((list) => list.filter((a) => a.id !== active.id));
      setStorageError(
        "Signed out here, but browser storage could not be cleared. Remove this site’s saved data before sharing this browser.",
      );
    }
  }, [active]);
  if (!active)
    return (
      <>
        <Login onLogin={onLogin} />
        {storageError && (
          <div role="alert" className="toast">
            {storageError}
          </div>
        )}
      </>
    );
  return (
    <>
      <div className={`app-shell ${showNav ? "navigation-open" : ""}`}>
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
              title={orgLabel(sessions[a.id]?.name || a.name, a.url)}
              aria-label={`Open ${orgLabel(sessions[a.id]?.name || a.name, a.url)}${unreadCounts[a.id] ? `, ${unreadCounts[a.id]} unread` : ""}`}
              aria-pressed={a.id === active.id}
              className={`rail-button org ${a.id === active.id ? "selected" : ""}`}
              style={
                { "--org-hue": String(150 + i * 75) } as React.CSSProperties
              }
              onClick={() => setActiveId(a.id)}
            >
              {initials(sessions[a.id]?.name || a.name)}
              {a.id !== active.id && !!unreadCounts[a.id] && (
                <span className="badge">
                  {unreadCounts[a.id] > 99 ? "99+" : unreadCounts[a.id]}
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
          key={`${active.id}:${active.apiKey}`}
          account={active}
          session={sessions[active.id]}
          notificationTarget={notificationTarget}
          onLogout={logout}
          showNav={showNav}
          setShowNav={setShowNav}
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
  showNav,
  setShowNav,
  notificationTarget,
}: {
  account: Account;
  session?: Session;
  notificationTarget?: NotificationTarget;
  onLogout: () => void;
  showNav: boolean;
  setShowNav: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const cache = getCache(account);
  const access = useAccess(account, session);
  const [topicEditor, setTopicEditor] = useState<{
    channelId: number;
    topic: string;
  } | null>(null);
  const topicVersion = useSyncExternalStore(
    cache.subscribeTopics,
    cache.topicSnapshot,
  );
  const threadMutes = useThreadMutes(account.id);
  const [topicMenu, setTopicMenu] = useState<TopicMenuTarget | null>(null);
  const closeTopicMenu = useCallback(() => setTopicMenu(null), []);
  const [channelMenu, setChannelMenu] = useState<ChannelMenuTarget | null>(
    null,
  );
  const closeChannelMenu = useCallback(() => setChannelMenu(null), []);
  const openChannelMenu = useCallback((target: ChannelMenuTarget) => {
    setTopicMenu(null);
    setChannelMenu(target);
  }, []);
  const [directoryChannelId, setDirectoryChannelId] = useState<number>();
  const [appearance, setAppearance] = useState(false);
  const [panel, setPanel] = useState<
    | "search"
    | "starred"
    | "mentioned"
    | "directory"
    | "organisation"
    | "drafts"
    | "scheduled"
    | null
  >(null);
  const openPanel = useCallback(
    (
      next:
        | "search"
        | "starred"
        | "mentioned"
        | "directory"
        | "organisation"
        | "drafts"
        | "scheduled",
    ) => {
      const main = document.querySelector<HTMLElement>(".main-pane");
      if (main) main.inert = false;
      if (["search", "starred", "mentioned"].includes(next))
        document
          .querySelector<HTMLInputElement>(
            '.main-pane [aria-label="Search message text"]',
          )
          ?.focus();
      setPanel(next);
      setDirectoryChannelId(undefined);
      setShowNav(false);
    },
    [setShowNav],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        document.querySelector("dialog[open]")
      )
        return;
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          !!e.target.closest("input, textarea, select"));
      if (
        !typing &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        ["/", "*", "@"].includes(e.key)
      ) {
        e.preventDefault();
        openPanel(
          e.key === "/" ? "search" : e.key === "*" ? "starred" : "mentioned",
        );
      }
      if (
        !typing &&
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        ((e.key === "d" && messagingViews.drafts) ||
          (e.key === "s" && messagingViews.scheduled))
      ) {
        e.preventDefault();
        openPanel(e.key === "d" ? "drafts" : "scheduled");
      }
      if (e.key === "Escape" && !typing && panel && !showNav) {
        e.preventDefault();
        setPanel(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [openPanel, panel, showNav]);
  const [showTools, setShowTools] = useState(false);
  const [topicLimits, setTopicLimits] = useState<Record<number, number>>({});
  const [view, setView] = useState<View>({ type: "home" });
  useEffect(() => {
    if (notificationTarget?.accountId === account.id) {
      setPanel(null);
      setView(notificationTarget.view);
      setShowNav(false);
    }
  }, [notificationTarget, account.id, setShowNav]);
  const [expanded, setExpanded] = useState<number[]>([]),
    [topics, setTopics] = useState<Record<number, Topic[]>>({});
  const [filter, setFilter] = useState(""),
    [showMembers, setShowMembers] = useState(true),
    [topicError, setTopicError] = useState("");
  const search = useDeferredValue(filter.toLowerCase());
  const channels = session?.channels || [];
  const menuChannel = channels.find(
    (channel) => channel.stream_id === channelMenu?.channelId,
  );
  useEffect(() => {
    if (channelMenu && !menuChannel) setChannelMenu(null);
  }, [channelMenu, menuChannel]);
  const users = useMemo(
    () =>
      (session?.users || emptyUsers).filter(
        (u) => !session?.mutedUsers?.includes(u.user_id),
      ),
    [session?.users, session?.mutedUsers],
  );
  const navigationVersion = useSyncExternalStore(
    cache.subscribeNavigation,
    cache.navigationSnapshot,
  );
  const lastNavigation = useRef(navigationVersion);
  useLayoutEffect(() => {
    if (lastNavigation.current === navigationVersion) return;
    lastNavigation.current = navigationVersion;
    setView((current) => {
      let target = cache.resolveView(current);
      if (current.type === "channel" && current.topic === undefined) {
        const draft = cache.ui(current);
        if (draft.topic) {
          const typed = { ...current, topic: draft.topic };
          const moved = cache.resolveView(typed);
          if (JSON.stringify(moved) !== JSON.stringify(typed)) {
            target = moved;
            const next = cache.ui(target);
            if (!next.text) {
              next.text = draft.text;
              next.topic = target.type === "channel" ? target.topic || "" : "";
              draft.text = "";
            }
          }
        }
      }
      return target;
    });
  }, [cache, navigationVersion]);
  useEffect(() => {
    if (!session?.ready) return;
    setView((current) =>
      current.type === "channel" &&
      !session.channels.some((c) => c.stream_id === current.channelId)
        ? { type: "home" }
        : current.type === "profile" &&
            session.mutedUsers.includes(current.userId)
          ? { type: "home" }
          : current,
    );
    setExpanded((ids) =>
      ids.filter((id) => session.channels.some((c) => c.stream_id === id)),
    );
    setTopics((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) =>
          session.channels.some((c) => c.stream_id === Number(id)),
        ),
      ),
    );
  }, [session?.channels, session?.mutedUsers, session?.ready]);
  const userMap = useMemo(
    () => new Map(users.map((user) => [user.user_id, user])),
    [users],
  );
  const navToggle = useRef<HTMLButtonElement>(null);
  const navClose = useRef<HTMLButtonElement>(null);
  const closeNav = useCallback(() => {
    setShowNav(false);
    const main = document.querySelector<HTMLElement>(".main-pane");
    if (main) main.inert = false;
    navToggle.current?.focus();
  }, []);
  useEffect(() => {
    if (!showNav) return;
    const mobile = matchMedia(
      "(max-width: 640px), (max-width: 900px) and (pointer: coarse), (max-height: 500px) and (pointer: coarse)",
    );
    const background = [
      ...document.querySelectorAll<HTMLElement>(".main-pane, .members"),
    ];
    const apply = () => {
      background.forEach((element) => {
        element.inert = mobile.matches;
      });
    };
    apply();
    mobile.addEventListener("change", apply);
    navClose.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (
        !mobile.matches ||
        document.querySelector('dialog[open], [role="menu"]')
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeNav();
      }
      if (event.key === "Tab") {
        const buttons = [
          ...document.querySelectorAll<HTMLElement>(
            ".org-rail button, .sidebar button, .sidebar input",
          ),
        ].filter(
          (element) =>
            element.getClientRects().length &&
            !element.hasAttribute("disabled"),
        );
        const first = buttons[0],
          last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      background.forEach((element) => {
        element.inert = false;
      });
      window.removeEventListener("keydown", key);
      mobile.removeEventListener("change", apply);
    };
  }, [showNav, closeNav]);
  const selectedChannel =
    view.type === "channel"
      ? channels.find((c) => c.stream_id === view.channelId)
      : undefined;
  useEffect(() => {
    const home = () => {
      setPanel(null);
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
      expanded
        .filter(
          (id) => channels.some((c) => c.stream_id === id) && !session?.locked,
        )
        .map(async (id) => {
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
  const select = useCallback(
    (next: View) => {
      setPanel(null);
      setView(next);
      setChannelMenu(null);
      setShowNav(false);
    },
    [setShowNav],
  );
  const toggleChannel = useCallback(
    (id: number) =>
      setExpanded((ids) =>
        ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id],
      ),
    [],
  );
  const openChannel = useCallback(
    (id: number) => {
      select({ type: "channel", channelId: id });
      setExpanded((ids) => (ids.includes(id) ? ids : [...ids, id]));
    },
    [select],
  );
  const me = userMap.get(account.userId);
  const members = useMemo(
    () =>
      users
        .filter((u) => u.is_active && !u.is_bot)
        .sort((a, b) => memberCollator.compare(a.full_name, b.full_name)),
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
          <span
            className="org-name"
            title={orgLabel(session?.name || account.name, account.url)}
          >
            {session?.name || account.name}
          </span>
          <small
            className={`connection-state ${session?.status === "Live" ? "connection-live" : ""}`}
            role="status"
            aria-live="polite"
            title={session?.status || "Connecting"}
          >
            <i
              className={`status-dot ${session?.status === "Live" ? "" : "offline"}`}
              aria-hidden="true"
            />
            <span className="connection-label">
              {session?.status || "Connecting"}
            </span>
          </small>
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
            placeholder="Find channels or people"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="nav-scroll">
          <div className="section-label">
            YOUR CHANNELS <span>{channels.length}</span>
          </div>
          {channels
            .filter((c) => c.name.toLowerCase().includes(search))
            .map((channel) => (
              <div key={channel.stream_id}>
                <ChannelNavRow
                  channel={channel}
                  expanded={expanded.includes(channel.stream_id)}
                  selected={
                    view.type === "channel" &&
                    view.channelId === channel.stream_id
                  }
                  toggle={toggleChannel}
                  open={openChannel}
                  menu={openChannelMenu}
                />
                {expanded.includes(channel.stream_id) && (
                  <div className="topics">
                    {!topics[channel.stream_id] && (
                      <small>Loading threads…</small>
                    )}
                    {topics[channel.stream_id]
                      ?.slice(0, topicLimits[channel.stream_id] || 20)
                      .map((topic) => {
                        const key = topicKey(channel.stream_id, topic.name),
                          mute = threadMutes[key];
                        const muted =
                          !!mute ||
                          serverMutesTopic(
                            session,
                            channel.stream_id,
                            topic.name,
                          );
                        const unread = muted
                          ? 0
                          : session?.topicUnreads[key] || 0;
                        return (
                          <TopicNavRow
                            key={topic.name}
                            channelId={channel.stream_id}
                            topic={topic.name}
                            muted={muted}
                            until={mute?.until}
                            unread={unread}
                            selected={
                              view.type === "channel" &&
                              view.channelId === channel.stream_id &&
                              view.topic === topic.name
                            }
                            select={select}
                            menu={setTopicMenu}
                          />
                        );
                      })}
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
              No channels yet.
              <button
                className="nav-row"
                onClick={() => openPanel("directory")}
              >
                Browse channels
              </button>
            </p>
          )}
          {session?.unreadIncomplete && (
            <p className="nav-empty">
              Unread counts cover recent messages only.
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
                account={account}
                userId={user.user_id}
                org={account.url}
              />
              <span>
                {user.full_name}
                <PresenceStatus account={account} userId={user.user_id} />
              </span>
            </button>
          ))}
          {visiblePeople.length > 40 && (
            <p className="nav-empty">
              Search to find more people ({visiblePeople.length}).
            </p>
          )}
        </div>
        <div className="sidebar-tools">
          <button
            className="nav-row sidebar-tools-toggle"
            aria-expanded={showTools}
            aria-controls="sidebar-tools-list"
            onClick={() => setShowTools(!showTools)}
          >
            <ChevronRight size={16} aria-hidden="true" />
            More
          </button>
          <div
            id="sidebar-tools-list"
            className="sidebar-tools-list"
            hidden={!showTools}
          >
            {messagingViews.drafts && (
              <button className="nav-row" onClick={() => openPanel("drafts")}>
                <FileText size={18} />
                Drafts
              </button>
            )}
            {messagingViews.scheduled && (
              <button
                className="nav-row"
                onClick={() => openPanel("scheduled")}
              >
                <CalendarClock size={18} />
                Scheduled messages
              </button>
            )}
            <button
              className="nav-row"
              aria-label="Search messages"
              onClick={() => openPanel("search")}
            >
              <Search size={18} />
              Search messages <small>/</small>
            </button>
            <button
              className="nav-row"
              onClick={() => openPanel("organisation")}
            >
              <Settings2 size={18} />
              Organisation controls
            </button>
            <button className="nav-row" onClick={() => openPanel("directory")}>
              <Compass size={18} />
              Channel directory
            </button>
            <button className="nav-row" onClick={() => openPanel("starred")}>
              <Star size={18} />
              Starred messages
            </button>
            <button className="nav-row" onClick={() => openPanel("mentioned")}>
              <AtSign size={18} />
              Mentions
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
          </div>
        </div>
        <footer className="profile">
          <Avatar
            small
            name={me?.full_name || account.email}
            url={me?.avatar_url}
            account={account}
            userId={account.userId}
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
          {!panel && view.type === "channel" ? (
            selectedChannel?.invite_only ? (
              <Lock className="header-hash" size={24} />
            ) : (
              <Hash className="header-hash" size={24} />
            )
          ) : (
            <AtSign className="header-hash" size={24} />
          )}
          <strong>
            {panel === "drafts"
              ? "Drafts"
              : panel === "scheduled"
                ? "Scheduled messages"
                : panel === "organisation"
                  ? "Organisation controls"
                  : panel === "directory"
                    ? "Channel directory"
                    : panel === "search"
                      ? "Message search"
                      : panel === "starred"
                        ? "Starred messages"
                        : panel === "mentioned"
                          ? "Mentions"
                          : title}
          </strong>
          {panel && (
            <button
              className="icon-button profile-back"
              aria-label="Back to conversation"
              onClick={() => setPanel(null)}
            >
              <X size={18} />
            </button>
          )}
          {!panel &&
            view.type === "channel" &&
            selectedChannel?.invite_only && (
              <span className="private-label">Private</span>
            )}
          {panel ? null : view.type === "channel" &&
            view.topic !== undefined ? (
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
        {session?.locked ? (
          <div className="empty-state" role="alert">
            This session is locked. Remove the organization and sign in again.
          </div>
        ) : !session?.ready ? (
          <div className="empty-state" role="status">
            Connecting securely…
          </div>
        ) : panel === "drafts" || panel === "scheduled" ? (
          <MessagingNavigation
            account={account}
            view={view}
            kind={panel}
            channelIds={channels.map((c) => c.stream_id)}
            onSelect={select}
            onClose={() => setPanel(null)}
          />
        ) : panel === "organisation" ? (
          <OrganisationPanel
            account={account}
            access={access}
            users={session.users}
          />
        ) : panel === "directory" ? (
          <Suspense
            fallback={
              <div className="empty-state" role="status">
                Loading channels…
              </div>
            }
          >
            <ChannelDirectory
              key={directoryChannelId ?? "directory"}
              initialChannelId={directoryChannelId}
              account={account}
              access={access}
              users={session.users}
            />
          </Suspense>
        ) : panel ? (
          <SearchPanel
            key={panel}
            account={account}
            channels={channels}
            featureLevel={getFeatureLevel(account.url)}
            special={panel === "search" ? undefined : panel}
            onSelect={select}
          />
        ) : (
          <Conversation
            key={JSON.stringify(view)}
            readingEnabled={
              !showNav &&
              !appearance &&
              !topicMenu &&
              !topicEditor &&
              !channelMenu
            }
            account={account}
            view={view}
            title={title}
            users={users}
            recentConversations={session.recentConversations}
            privateChannel={!!selectedChannel?.invite_only}
            onSelect={select}
          />
        )}
      </main>
      {channelMenu && menuChannel && !session?.locked && (
        <ChannelMenu
          account={account}
          channel={menuChannel}
          target={channelMenu}
          featureLevel={access.featureLevel}
          onClose={closeChannelMenu}
          onSettings={() => {
            openPanel("directory");
            setDirectoryChannelId(menuChannel.stream_id);
          }}
        />
      )}
      {topicMenu && !session?.locked && (
        <TopicMenu
          account={account}
          target={topicMenu}
          muted={!!threadMutes[topicKey(topicMenu.channelId, topicMenu.topic)]}
          featureLevel={access.featureLevel}
          serverMuted={serverMutesTopic(
            session,
            topicMenu.channelId,
            topicMenu.topic,
          )}
          followed={
            !!session?.followedTopics.includes(
              topicKey(topicMenu.channelId, topicMenu.topic),
            )
          }
          onManage={
            channels.some(
              (c) =>
                c.stream_id === topicMenu.channelId &&
                (["rename", "move", "resolve"] as const).some((a) =>
                  canTopic(access, c, a),
                ),
            )
              ? () => {
                  setShowNav(false);
                  setTopicEditor({
                    channelId: topicMenu.channelId,
                    topic: topicMenu.topic,
                  });
                }
              : undefined
          }
          onOpen={() =>
            select({
              type: "channel",
              channelId: topicMenu.channelId,
              topic: topicMenu.topic,
            })
          }
          onClose={closeTopicMenu}
        />
      )}
      {topicEditor &&
        !session?.locked &&
        channels.some((c) => c.stream_id === topicEditor.channelId) && (
          <TopicEditor
            account={account}
            channel={channels.find(
              (c) => c.stream_id === topicEditor.channelId,
            )!}
            channels={channels}
            topic={topicEditor.topic}
            access={access}
            onClose={() => setTopicEditor(null)}
          />
        )}
      {appearance && <Appearance onClose={() => setAppearance(false)} />}
      {showMembers && !session?.locked && (
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
  readingEnabled,
  account,
  view,
  title,
  users,
  privateChannel,
  recentConversations,
  onSelect,
}: {
  readingEnabled: boolean;
  account: Account;
  view: View;
  title: string;
  users: User[];
  privateChannel: boolean;
  recentConversations: RecentConversation[];
  onSelect: (view: View) => void;
}) {
  const {
    messages,
    loading,
    error: loadError,
    hasOlder,
    hasNewer,
    cache,
  } = useMessages(account, view);
  const [error, setError] = useState(""),
    [olderBusy, setOlderBusy] = useState(false),
    [newerBusy, setNewerBusy] = useState(false);
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
  useReadMessages(account, view, scroller, messages, readingEnabled, setError);
  const reply = useCallback(
    (message: Message) => composer.current?.reply(message),
    [],
  );
  const quote = useCallback(
    (message: Message, raw: string) => {
      if (composer.current) {
        composer.current.quote(message, raw);
        return;
      }
      const target: Destination =
        message.type === "stream" && message.stream_id !== undefined
          ? {
              type: "channel",
              channelId: message.stream_id,
              topic: message.subject,
            }
          : {
              type: "dm",
              userIds: Array.isArray(message.display_recipient)
                ? message.display_recipient
                    .map((u) => u.id)
                    .filter((id) => id !== account.userId)
                : [account.userId],
            };
      if (target.type === "dm" && !target.userIds.length)
        target.userIds = [account.userId];
      try {
        const old = draftFor(account.id, target),
          current = old?.text || cache.ui(target).text;
        const text = `${current}${current ? "\n" : ""}${quoteMessage(account, message, raw)}`;
        saveDraft(account.id, {
          id: destinationKey(target),
          view: target,
          text,
          topic: message.subject,
          updated: Date.now(),
        });
        const saved = cache.ui(target);
        saved.text = text;
        saved.topic = message.subject;
        onSelect(target);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not save quote draft.",
        );
      }
    },
    [account, cache, onSelect],
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
  // Message bodies fill in their own layout effects, which run before this one.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (
      !saved.atBottom &&
      saved.anchorId !== undefined &&
      saved.anchorTop !== undefined &&
      restoreAnchor(el, { id: String(saved.anchorId), top: saved.anchorTop })
    )
      return;
    el.scrollTop = saved.scrollTop;
  }, [saved]);
  // Rows are added and dropped at both ends by paging, live events and
  // revalidation. Away from the live end, keep the row being read in place.
  const reading = useRef<ReadingAnchor | null>(null);
  const capture = () => {
    const el = scroller.current;
    reading.current = el ? readingAnchor(el) : null;
    saved.anchorId = reading.current ? Number(reading.current.id) : undefined;
    saved.anchorTop = reading.current?.top;
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (!atBottom.current && reading.current)
      restoreAnchor(el, reading.current);
    capture();
  }, [messages]);
  // Keep the newest message visible when the keyboard or window shrinks the pane.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let height = el.clientHeight;
    const observer = new ResizeObserver(() => {
      if (el.clientHeight !== height && atBottom.current)
        el.scrollTop = el.scrollHeight;
      height = el.clientHeight;
    });
    observer.observe(el);
    const imageLoaded = () => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener("load", imageLoaded, true);
    return () => {
      observer.disconnect();
      el.removeEventListener("load", imageLoaded, true);
    };
  }, []);
  const lastMessage = useRef<number | undefined>(undefined),
    paging = useRef(false);
  // Paging changes which rows exist; it is not news once that render has landed.
  const endPaging = () =>
    requestAnimationFrame(() => {
      paging.current = false;
    });
  useEffect(() => {
    if (view.type === "profile" || view.type === "home") return;
    const latest = messages.at(-1)?.id;
    if (atBottom.current && !hasNewer)
      requestAnimationFrame(() =>
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight }),
      );
    else if (
      !paging.current &&
      lastMessage.current !== undefined &&
      latest !== lastMessage.current
    )
      setNewBelow(true);
    lastMessage.current = latest;
  }, [messages, view.type, hasNewer]);
  async function older() {
    setOlderBusy(true);
    paging.current = true;
    capture();
    try {
      await cache.older(view);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setOlderBusy(false);
      endPaging();
    }
  }
  const newerFlight = useRef(false),
    scrollFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);
  async function newer() {
    if (newerFlight.current) return;
    newerFlight.current = true;
    setNewerBusy(true);
    paging.current = true;
    capture();
    try {
      await cache.newer(view);
    } catch (e) {
      setError(errorText(e));
    } finally {
      newerFlight.current = false;
      setNewerBusy(false);
      endPaging();
    }
  }
  function jumpToLatest() {
    atBottom.current = true;
    saved.atBottom = true;
    saved.anchorId = undefined;
    saved.anchorTop = undefined;
    reading.current = null;
    setNewBelow(false);
    if (hasNewer) {
      void cache.load(view, true);
      if (view.type === "profile") scroller.current?.scrollTo({ top: 0 });
      return;
    }
    scroller.current?.scrollTo({
      top: view.type === "profile" ? 0 : scroller.current.scrollHeight,
      behavior:
        document.documentElement.dataset.motion === "off" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
    });
  }
  const dms = new Map<
    string,
    { ids: number[]; message?: Message; maxId: number }
  >();
  if (view.type === "home")
    for (const message of [...messages].reverse()) {
      if (!Array.isArray(message.display_recipient)) continue;
      const others = message.display_recipient
        .map((u) => u.id)
        .filter((id) => id !== account.userId)
        .sort((a, b) => a - b);
      const ids = others.length ? others : [account.userId],
        key = ids.join(",");
      if (!dms.has(key)) dms.set(key, { ids, message, maxId: message.id });
    }
  if (view.type === "home")
    for (const conversation of recentConversations) {
      const ids = conversation.user_ids.length
        ? [...conversation.user_ids].sort((a, b) => a - b)
        : [account.userId];
      if (ids.some((id) => id !== account.userId && !userMap.has(id))) continue;
      const key = ids.join(",");
      if (!dms.has(key))
        dms.set(key, { ids, maxId: conversation.max_message_id });
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
          // Profiles list the newest post first, so their live end is the top.
          const gap =
            view.type === "profile"
              ? el.scrollTop
              : el.scrollHeight - el.scrollTop - el.clientHeight;
          // The end of a history window is not the end of the conversation.
          atBottom.current = gap < 100 && !hasNewer;
          saved.scrollTop = el.scrollTop;
          saved.atBottom = atBottom.current;
          if (!scrollFrame.current)
            scrollFrame.current = requestAnimationFrame(() => {
              scrollFrame.current = 0;
              capture();
            });
          if (atBottom.current) setNewBelow(false);
          if (hasNewer && gap < 300) void newer();
        }}
      >
        {view.type === "profile" ? (
          <ProfilePage
            account={account}
            users={users}
            user={userMap.get(view.userId)}
            userId={view.userId}
            messages={messages}
            loading={loading}
            hasOlder={hasOlder}
            olderBusy={olderBusy}
            older={older}
            hasNewer={hasNewer}
            newerBusy={newerBusy}
            newer={newer}
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
                {[...dms]
                  .sort((a, b) => b[1].maxId - a[1].maxId)
                  .map(([key, { ids, message }]) => {
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
                          account={account}
                          userId={
                            ids.length === 1 && !userMap.get(ids[0])?.is_bot
                              ? ids[0]
                              : undefined
                          }
                        />
                        <span>
                          <strong>{name}</strong>
                          <small>
                            {message
                              ? `Last message from ${message.sender_full_name}`
                              : "Open conversation"}
                          </small>
                        </span>
                        <time>
                          {message
                            ? new Date(
                                message.timestamp * 1000,
                              ).toLocaleDateString()
                            : ""}
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
                  onQuote={quote}
                  canDelete={(userMap.get(account.userId)?.role ?? 400) <= 200}
                  onError={setError}
                />
              ))
            )}
            {hasNewer && view.type !== "home" && (
              <button
                className="load-older load-newer"
                disabled={newerBusy}
                onClick={() => void newer()}
              >
                {newerBusy ? "Loading…" : "Load newer messages"}
              </button>
            )}
          </>
        )}
      </div>
      {(newBelow || (hasNewer && view.type !== "home")) && (
        <button className="new-below" onClick={jumpToLatest}>
          <ArrowDown size={14} />
          {hasNewer ? "Jump to latest" : "New messages"}
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
        <TypingIndicator account={account} view={view} users={users} />
      )}
      {view.type !== "home" && view.type !== "profile" && (
        <Composer
          ref={composer}
          users={users}
          account={account}
          view={view}
          title={title}
          privateChannel={privateChannel}
          onSelect={onSelect}
          saved={saved}
          onSent={sent}
          onError={setError}
        />
      )}
    </>
  );
});
