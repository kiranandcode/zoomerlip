import { memo } from "react";
import {
  BellOff,
  ChevronDown,
  ChevronRight,
  Hash,
  Lock,
  MoreHorizontal,
} from "lucide-react";
import type { Channel, View } from "../types";
import type { TopicMenuTarget } from "./TopicMenu";
import type { ChannelMenuTarget } from "./ChannelMenu";

export const ChannelNavRow = memo(function ChannelNavRow({
  channel,
  expanded,
  selected,
  unread = 0,
  toggle,
  open,
  menu,
}: {
  channel: Channel;
  expanded: boolean;
  selected: boolean;
  unread?: number;
  toggle: (id: number) => void;
  open: (id: number) => void;
  menu: (target: ChannelMenuTarget) => void;
}) {
  const openMenu = (trigger: HTMLElement, x?: number, y?: number) => {
    const box = trigger.getBoundingClientRect();
    menu({
      channelId: channel.stream_id,
      trigger,
      x: x ?? box.left,
      y: y ?? box.bottom,
    });
  };
  return (
    <div
      className={`channel-row ${selected ? "current" : ""} ${channel.is_muted ? "muted" : ""} ${unread ? "unread" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(
          event.currentTarget.querySelector<HTMLButtonElement>(
            ".channel-name",
          )!,
          event.clientX,
          event.clientY,
        );
      }}
    >
      <button
        className="expand"
        aria-label={`${expanded ? "Collapse" : "Expand"} ${channel.name}`}
        aria-expanded={expanded}
        onClick={() => toggle(channel.stream_id)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      <button
        className="channel-name"
        aria-label={
          channel.invite_only
            ? `${channel.name} (private channel)`
            : channel.name
        }
        aria-description={unread ? `${unread} unread messages` : undefined}
        onClick={() => open(channel.stream_id)}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            openMenu(event.currentTarget);
          }
        }}
      >
        {channel.invite_only ? <Lock size={18} /> : <Hash size={18} />}
        <span>{channel.name}</span>
        {channel.is_muted && <BellOff size={13} aria-label="Muted" />}
        {unread > 0 && (
          <span className="thread-badge" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <button
        className="topic-options channel-options"
        aria-label={`Channel options: ${channel.name}`}
        aria-haspopup="menu"
        onClick={(event) => openMenu(event.currentTarget)}
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
});
export const TopicNavRow = memo(function TopicNavRow({
  channelId,
  topic,
  muted,
  until,
  unread,
  selected,
  select,
  menu,
}: {
  channelId: number;
  topic: string;
  muted: boolean;
  until?: number | null;
  unread: number;
  selected: boolean;
  select: (view: View) => void;
  menu: (target: TopicMenuTarget) => void;
}) {
  const label = topic || "(no topic)";
  const openMenu = (trigger: HTMLElement, x?: number, y?: number) => {
    const rect = trigger.getBoundingClientRect();
    menu({ channelId, topic, trigger, x: x ?? rect.left, y: y ?? rect.bottom });
  };
  return (
    <div
      className={`topic-row ${muted ? "muted" : ""} ${unread ? "unread" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(
          event.currentTarget.querySelector("button")!,
          event.clientX,
          event.clientY,
        );
      }}
    >
      <button
        className={`topic ${selected ? "active" : ""}`}
        aria-label={`${label}${muted ? ", muted" : ""}${unread ? `, ${unread} unread` : ""}`}
        title={
          until === null
            ? "Muted until you unmute"
            : until !== undefined
              ? `Muted until ${new Date(until).toLocaleString()}`
              : muted
                ? "Muted in Zulip"
                : label
        }
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            openMenu(event.currentTarget);
          }
        }}
        onClick={() => select({ type: "channel", channelId, topic })}
      >
        <span className="topic-marker" aria-hidden="true">
          ↳
        </span>
        <span className="topic-name">{label}</span>
        {muted && <BellOff size={12} aria-hidden="true" />}
        {unread > 0 && (
          <span className="thread-badge" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <button
        className="topic-options"
        aria-label={`Thread options: ${label}`}
        aria-haspopup="menu"
        onClick={(event) => openMenu(event.currentTarget)}
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
});
