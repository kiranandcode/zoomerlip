import { request } from "../api";
import type { Account } from "../types";
import { messagingCapabilities } from "./capabilities";
export type ProductivityKind =
  "scheduled_messages" | "saved_snippets" | "reminders";
export type ProductivityItem = {
  id: number;
  content: string;
  title?: string;
  type?: "stream" | "private";
  to?: number | number[];
  topic?: string;
  scheduled_delivery_timestamp?: number;
  failed?: boolean;
  reminder_target_message_id?: number;
};
export const minimumLevel = {
  scheduled_messages: 184,
  saved_snippets: 297,
  reminders: 399,
};
export const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function futureTimestamp(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= now)
    throw new Error("Choose a valid future date and time.");
  return Math.floor(timestamp / 1000);
}
export function localDateTime(timestamp: number) {
  const d = new Date(timestamp * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export async function listProductivity(
  account: Account,
  kind: ProductivityKind,
  signal: AbortSignal,
): Promise<ProductivityItem[]> {
  if (messagingCapabilities(account.id).featureLevel < minimumLevel[kind])
    throw new Error(
      `This server does not support these controls (requires feature level ${minimumLevel[kind]}).`,
    );
  const d = await request<Record<string, unknown>>(
    account,
    `/${kind}`,
    {},
    "GET",
    signal,
  );
  const items = d[kind];
  if (!Array.isArray(items) || items.length > 1000)
    throw new Error("Invalid or oversized server list (maximum 1,000 items).");
  return items.map((item) => {
    const id =
      kind === "scheduled_messages"
        ? item.scheduled_message_id
        : kind === "reminders"
          ? item.reminder_id
          : item.id;
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      typeof item.content !== "string"
    )
      throw new Error("Invalid server item.");
    return { ...item, id };
  });
}
export async function createReminder(
  account: Account,
  messageId: number,
  when: string,
  note: string,
  signal: AbortSignal,
) {
  const level = messagingCapabilities(account.id).featureLevel;
  if (level < 381)
    throw new Error("Reminders require server feature level 381 or newer.");
  if (note && level < 415)
    throw new Error(
      "Reminder notes require server feature level 415 or newer.",
    );
  return request<{ reminder_id: number }>(
    account,
    "/reminders",
    {
      message_id: messageId,
      scheduled_delivery_timestamp: futureTimestamp(when),
      ...(note ? { note } : {}),
    },
    "POST",
    signal,
  );
}
export async function rescheduleReminder(
  account: Account,
  item: ProductivityItem,
  when: string,
  note: string,
  signal: AbortSignal,
) {
  if (!item.reminder_target_message_id)
    throw new Error("Reminder has no target message.");
  const created = await createReminder(
    account,
    item.reminder_target_message_id,
    when,
    note,
    signal,
  );
  try {
    await request(account, `/reminders/${item.id}`, {}, "DELETE", signal);
  } catch {
    throw new Error(
      `Replacement reminder ${created.reminder_id} was created, but old reminder ${item.id} could not be removed. Refresh the list and delete the duplicate. Do not retry creation.`,
    );
  }
}
