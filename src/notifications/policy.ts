import type { Account, Message, Channel } from "../types";
import type { Session } from "../sessionModel";
import { topicKey } from "../sessionModel";
import type { NotificationPreferences } from "./preferences";
export type NotificationContext = {
  settings: Record<string, unknown>;
  followed: string[];
  session: Session;
  localMutes: Record<string, unknown>;
};
export type NotificationChannel = Channel & {
  desktop_notifications?: boolean | null;
  audible_notifications?: boolean | null;
  wildcard_mentions_notify?: boolean | null;
};
export function notificationRule(
  account: Account,
  message: Message,
  prefs: NotificationPreferences,
  context: NotificationContext,
): { visual: boolean; sound: boolean } {
  const no = { visual: false, sound: false };
  if (
    !prefs.enabled ||
    message.sender_id === account.userId ||
    message.flags?.includes("read") ||
    context.session.mutedUsers.includes(message.sender_id)
  )
    return no;
  const s = context.settings,
    flags = message.flags || [];
  let personal = message.type === "private" && prefs.dms;
  let channelVisual = false,
    channelSound = false;
  if (message.type === "stream") {
    const channel = context.session.channels.find(
      (c) => c.stream_id === message.stream_id,
    ) as NotificationChannel | undefined;
    if (!channel) return no;
    const key = topicKey(channel.stream_id, message.subject);
    if (context.localMutes[key]) return no;
    const followed = context.followed.includes(key),
      muted =
        context.session.mutedTopics.includes(key) ||
        (channel.is_muted && !context.session.unmutedTopics.includes(key));
    // Personal mentions can notify in server-muted topics; local timed mutes silence all.
    const wildcard = followed
      ? s.enable_followed_topic_wildcard_mentions_notify
      : (channel.wildcard_mentions_notify ?? s.wildcard_mentions_notify);
    personal =
      prefs.mentions &&
      (flags.includes("mentioned") ||
        (!muted &&
          wildcard === true &&
          (flags.includes("wildcard_mentioned") ||
            flags.includes("stream_wildcard_mentioned") ||
            flags.includes("topic_wildcard_mentioned"))));
    if (!muted) {
      channelVisual =
        (followed && s.enable_followed_topic_desktop_notifications === true) ||
        (channel.desktop_notifications ??
          s.enable_stream_desktop_notifications) === true;
      channelSound =
        (followed && s.enable_followed_topic_audible_notifications === true) ||
        (channel.audible_notifications ?? s.enable_stream_sounds) === true;
    }
  }
  return {
    visual:
      (personal && s.enable_desktop_notifications === true) || channelVisual,
    sound:
      prefs.sound && ((personal && s.enable_sounds === true) || channelSound),
  };
}
