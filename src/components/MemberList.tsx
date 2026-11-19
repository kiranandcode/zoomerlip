import { memo, useEffect, useRef, useState } from "react";
import type { Account, User, View } from "../types";
import { Avatar } from "./Avatar";
/** Fixed-height window: a large org never mounts thousands of avatars at once. */
export const MemberList = memo(function MemberList({
  members,
  account,
  onSelect,
}: {
  members: User[];
  account: Account;
  onSelect: (view: View) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() =>
      setViewport((v) => ({ ...v, height: el.clientHeight })),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const row = 48,
    start = Math.max(0, Math.floor(viewport.top / row) - 5),
    end = Math.min(
      members.length,
      Math.ceil((viewport.top + viewport.height) / row) + 5,
    );
  return (
    <div
      className="member-window"
      ref={ref}
      tabIndex={0}
      aria-label="Members"
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop;
        setViewport((v) => ({ ...v, top }));
      }}
    >
      <div style={{ height: members.length * row, position: "relative" }}>
        {members.slice(start, end).map((user, i) => (
          <button
            style={{
              position: "absolute",
              top: (start + i) * row,
              height: row,
            }}
            className="member"
            key={user.user_id}
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
              small
            />
            <span>
              {user.full_name}
              <small>
                {user.user_id === account.userId ? "You" : "Member"}
              </small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
});
