import { narrow, request } from "../api";
import type { Account, Message, View } from "../types";
export type SearchFilters = {
  text: string;
  sender: string;
  channel: string;
  topic: string;
  after: string;
  before: string;
  attachment: boolean;
  special?: "starred" | "mentioned" | "unread";
};
export const emptySearch: SearchFilters = {
  text: "",
  sender: "",
  channel: "",
  topic: "",
  after: "",
  before: "",
  attachment: false,
};
export const SEARCH_PAGE = 50;
export const SEARCH_LIMIT = 200;
export function searchNarrow(filters: SearchFilters) {
  const result: { operator: string; operand: string | number }[] = [];
  for (const [field, operator] of [
    ["text", "search"],
    ["sender", "sender"],
    ["channel", "stream"],
    ["topic", "topic"],
    ["after", "after"],
    ["before", "before"],
  ] as const) {
    const value = filters[field].trim();
    if (!value) continue;
    if (value.length > 1000)
      throw new Error("Search filters must be under 1,000 characters.");
    if (
      (field === "after" || field === "before") &&
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    )
      throw new Error("Use YYYY-MM-DD dates.");
    result.push({
      operator,
      operand:
        (field === "channel" || field === "sender") && /^\d+$/.test(value)
          ? Number(value)
          : value,
    });
  }
  if (filters.after && filters.before && filters.after >= filters.before)
    throw new Error("The before date must follow the after date.");
  if (filters.attachment)
    result.push({ operator: "has", operand: "attachment" });
  if (filters.special)
    result.push({ operator: "is", operand: filters.special });
  return result;
}
export async function searchMessages(
  account: Account,
  filters: SearchFilters,
  cursor: number | undefined,
  signal: AbortSignal,
) {
  const data = await request<{ messages: Message[]; found_oldest: boolean }>(
    account,
    "/messages",
    {
      narrow: searchNarrow(filters),
      anchor: cursor ?? "newest",
      include_anchor: cursor === undefined,
      num_before: SEARCH_PAGE,
      num_after: 0,
      apply_markdown: true,
    },
    "GET",
    signal,
  );
  const messages = [
    ...new Map(
      data.messages
        .filter(
          (m) =>
            Number.isSafeInteger(m.id) &&
            (cursor === undefined || m.id < cursor),
        )
        .map((m) => [m.id, m]),
    ).values(),
  ]
    .sort((a, b) => b.id - a.id)
    .slice(0, SEARCH_PAGE);
  if (!data.found_oldest && !messages.length)
    throw new Error("Search pagination did not advance. Retry the search.");
  return { messages, cursor: messages.at(-1)?.id, done: data.found_oldest };
}
export function messageView(message: Message, me: number): View {
  if (message.type === "stream" && message.stream_id !== undefined)
    return {
      type: "channel",
      channelId: message.stream_id,
      topic: message.subject,
    };
  if (!Array.isArray(message.display_recipient))
    throw new Error("Invalid conversation.");
  const ids = message.display_recipient
    .map((u) => u.id)
    .filter((id) => id !== me);
  return { type: "dm", userIds: ids.length ? ids : [me] };
}
export async function messageContext(
  account: Account,
  message: Message,
  featureLevel: number,
  signal: AbortSignal,
) {
  // Re-fetch the target first: it may have moved since the search response.
  const latest = await request<{ message: Message }>(
    account,
    `/messages/${message.id}`,
    { apply_markdown: true },
    "GET",
    signal,
  );
  const view = messageView(latest.message, account.userId);
  const data = await request<{ messages: Message[] }>(
    account,
    "/messages",
    {
      narrow: narrow(view, featureLevel),
      anchor: message.id,
      num_before: 25,
      num_after: 25,
      apply_markdown: true,
    },
    "GET",
    signal,
  );
  return { view, messages: data.messages.slice(0, 51) };
}
