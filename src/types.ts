import type { GroupValue } from "./organisation/permissions";
export type Account = {
  id: string;
  url: string;
  email: string;
  apiKey: string;
  name: string;
  userId: number;
};
export type User = {
  user_id: number;
  full_name: string;
  email: string;
  avatar_url?: string;
  is_active: boolean;
  is_bot: boolean;
  role?: number;
  date_joined?: string;
  timezone?: string;
  profile_data?: Record<string, { value: string; rendered_value?: string }>;
};
export type Channel = {
  stream_id: number;
  name: string;
  description: string;
  color?: string;
  invite_only?: boolean;
  is_muted?: boolean;
  is_web_public?: boolean;
  history_public_to_subscribers?: boolean;
  can_administer_channel_group?: GroupValue;
  can_add_subscribers_group?: GroupValue;
  can_remove_subscribers_group?: GroupValue;
  can_subscribe_group?: GroupValue;
  can_move_messages_out_of_channel_group?: GroupValue;
  can_move_messages_within_channel_group?: GroupValue;
  can_resolve_topics_group?: GroupValue;
};
export type Topic = { name: string; max_id: number };
export type Reaction = {
  emoji_name: string;
  emoji_code: string;
  reaction_type: string;
  user_id: number;
};
export type Message = {
  id: number;
  sender_id: number;
  sender_full_name: string;
  avatar_url: string | null;
  timestamp: number;
  content: string;
  rendered_content?: string;
  type: "stream" | "private";
  stream_id?: number;
  subject: string;
  display_recipient:
    string | { id: number; full_name: string; email: string }[];
  reactions: Reaction[];
  submessages?: import("./messaging/widgets").Submessage[];
  widgetOverflow?: boolean;
  flags?: string[];
};
export type View =
  | { type: "channel"; channelId: number; topic?: string }
  | { type: "dm"; userIds: number[] }
  | { type: "home" }
  | { type: "profile"; userId: number; posts: "channels" | "all" };
export type ZulipEvent = {
  id: number;
  type: string;
  message?: Message;
  [key: string]: unknown;
};

export type RecentConversation = { user_ids: number[]; max_message_id: number };
