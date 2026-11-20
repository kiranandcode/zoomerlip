import { useMemo, useState } from "react";
import { MessageCircle, Users } from "lucide-react";
import { Avatar } from "./Avatar";
import { useMessages } from "../useMessages";
import type { Account, RecentConversation, User, View } from "../types";

const home: View = { type: "home" };
export function dmIds(ids: number[], me: number) {
  const others = [...new Set(ids)]
    .filter((id) => id !== me)
    .sort((a, b) => a - b);
  return others.length ? others : [me];
}

export function DmSidebar({
  account,
  users,
  recent,
  opened,
  view,
  search,
  select,
}: {
  account: Account;
  users: User[];
  recent: RecentConversation[];
  opened: number[][];
  view: View;
  search: string;
  select: (view: View) => void;
}) {
  const { messages, loading, error } = useMessages(account, home);
  const [limit, setLimit] = useState(60);
  const userMap = useMemo(
    () => new Map(users.map((user) => [user.user_id, user])),
    [users],
  );
  const conversations = useMemo(() => {
    const items = new Map<
      string,
      { ids: number[]; latest: number; name: string }
    >();
    function add(raw: number[], latest: number) {
      const ids = dmIds(raw, account.userId),
        key = ids.join(",");
      if (ids.some((id) => !userMap.has(id))) return;
      const previous = items.get(key);
      if (!previous || previous.latest < latest)
        items.set(key, {
          ids,
          latest,
          name: ids.map((id) => userMap.get(id)!.full_name).join(", "),
        });
    }
    for (const entry of recent) add(entry.user_ids, entry.max_message_id);
    for (const message of messages)
      if (
        message.type === "private" &&
        Array.isArray(message.display_recipient)
      )
        add(
          message.display_recipient.map((user) => user.id),
          message.id,
        );
    for (const ids of opened) add(ids, 0);
    if (view.type === "dm") add(view.userIds, 0);
    return [...items.values()].sort((a, b) => b.latest - a.latest);
  }, [account.userId, recent, opened, messages, userMap, view]);
  const filtered = conversations.filter((item) =>
    item.name.toLowerCase().includes(search),
  );
  const current =
    view.type === "dm" ? dmIds(view.userIds, account.userId).join(",") : "";
  const people = search
    ? users.filter(
        (user) =>
          user.is_active &&
          user.full_name.toLowerCase().includes(search) &&
          !filtered.some(
            (item) => item.ids.length === 1 && item.ids[0] === user.user_id,
          ),
      )
    : [];
  return (
    <nav className="dm-sidebar" aria-label="Direct message conversations">
      <button
        className={`nav-row ${view.type === "home" ? "active" : ""}`}
        onClick={() => select(home)}
      >
        <MessageCircle size={18} />
        All conversations
      </button>
      <div className="section-label">
        DIRECT MESSAGES <span>{conversations.length}</span>
      </div>
      {filtered.slice(0, limit).map((item) => (
        <button
          key={item.ids.join(",")}
          className={`nav-row dm-nav-row ${current === item.ids.join(",") ? "active" : ""}`}
          aria-current={current === item.ids.join(",") ? "page" : undefined}
          title={item.name}
          aria-label={item.name}
          onClick={() => select({ type: "dm", userIds: item.ids })}
        >
          {item.ids.length > 1 ? (
            <span className="avatar small">
              <Users size={18} />
            </span>
          ) : (
            <Avatar
              small
              name={item.name}
              url={userMap.get(item.ids[0])?.avatar_url}
              org={account.url}
              account={account}
              userId={item.ids[0]}
            />
          )}
          <span className="dm-nav-name">{item.name}</span>
        </button>
      ))}
      {filtered.length > limit && (
        <button className="nav-row" onClick={() => setLimit(limit + 60)}>
          More conversations
        </button>
      )}
      {loading && !conversations.length && (
        <p className="nav-empty" role="status">
          Loading conversations…
        </p>
      )}
      {error && (
        <p className="error" role="status">
          {error}
        </p>
      )}
      {!loading && !filtered.length && (
        <p className="nav-empty">
          {search
            ? "No matching conversations."
            : "Search for someone to start a conversation."}
        </p>
      )}
      {people.length > 0 && (
        <>
          <div className="section-label">START A CONVERSATION</div>
          {people.slice(0, 40).map((user) => (
            <button
              key={user.user_id}
              className="nav-row dm-nav-row"
              aria-label={user.full_name}
              onClick={() => select({ type: "dm", userIds: [user.user_id] })}
            >
              <Avatar
                small
                name={user.full_name}
                url={user.avatar_url}
                org={account.url}
              />
              <span className="dm-nav-name">{user.full_name}</span>
            </button>
          ))}
        </>
      )}
    </nav>
  );
}
