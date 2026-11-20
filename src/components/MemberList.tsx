import { memo, useEffect, useRef, useState } from "react";
import type { Account, User, View } from "../types";
import { Avatar } from "./Avatar";
import { PresenceStatus } from "../live/PresenceStatus";
function roleLabel(user: User) {
  const role = (user as User & { role?: number }).role;
  return role === 100
    ? "Owner"
    : role === 200
      ? "Administrator"
      : role === 300
        ? "Moderator"
        : role === 600
          ? "Guest"
          : "Member";
}
/** Windowed rows retain the focused member even when it scrolls off screen. */
export const MemberList = memo(function MemberList({
  members,
  account,
  onSelect,
}: {
  members: User[];
  account: Account;
  onSelect: (view: View) => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [viewport, setViewport] = useState({ top: 0, height: 600 }),
    [focusedId, setFocusedId] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() =>
      setViewport((v) => ({ ...v, height: el.clientHeight })),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const row = 48,
    start = Math.max(
      0,
      Math.min(members.length - 1, Math.floor(viewport.top / row) - 5),
    ),
    end = Math.min(
      members.length,
      Math.ceil((viewport.top + viewport.height) / row) + 5,
    ),
    focused = members.findIndex((user) => user.user_id === focusedId);
  const indices = [
    ...new Set([
      ...Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i),
      ...(focused >= 0 ? [focused] : []),
    ]),
  ].sort((a, b) => a - b);
  function move(index: number) {
    const user = members[index];
    if (!user) return;
    setFocusedId(user.user_id);
    const el = ref.current!;
    if (index * row < el.scrollTop) el.scrollTop = index * row;
    else if ((index + 1) * row > el.scrollTop + el.clientHeight)
      el.scrollTop = (index + 1) * row - el.clientHeight;
    setViewport((v) => ({ ...v, top: el.scrollTop }));
    requestAnimationFrame(() =>
      el
        .querySelector<HTMLButtonElement>(`[data-member-id="${user.user_id}"]`)
        ?.focus(),
    );
  }
  return (
    <div
      className="member-window"
      role="list"
      ref={ref}
      aria-label="Members"
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        setViewport((v) => ({ ...v, top }));
      }}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const target = event.target as HTMLElement;
        const id = Number(
          target.closest("[data-member-id]")?.getAttribute("data-member-id"),
        );
        const index = members.findIndex((user) => user.user_id === id);
        move(
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? members.length - 1
              : Math.max(
                  0,
                  Math.min(
                    members.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
        );
      }}
    >
      <div
        role="presentation"
        style={{ height: members.length * row, position: "relative" }}
      >
        {indices.map((index) => {
          const user = members[index];
          return (
            <div
              role="listitem"
              aria-posinset={index + 1}
              aria-setsize={members.length}
              key={user.user_id}
              style={{
                position: "absolute",
                top: index * row,
                height: row,
                width: "100%",
              }}
            >
              <button
                data-member-id={user.user_id}
                tabIndex={
                  focused >= 0
                    ? index === focused
                      ? 0
                      : -1
                    : index === 0
                      ? 0
                      : -1
                }
                className="member"
                style={{ height: row }}
                onFocus={() => setFocusedId(user.user_id)}
                onClick={() =>
                  onSelect({
                    type: "profile",
                    userId: user.user_id,
                    posts: "channels",
                  })
                }
              >
                <Avatar
                  name={user.full_name}
                  url={user.avatar_url}
                  org={account.url}
                  account={account}
                  userId={user.user_id}
                  small
                />
                <span>
                  {user.full_name}
                  <small>
                    {user.user_id === account.userId
                      ? `You · ${roleLabel(user)}`
                      : roleLabel(user)}
                    {" · "}
                    <PresenceStatus account={account} userId={user.user_id} />
                  </small>
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});
