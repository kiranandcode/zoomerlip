import { useEffect, useRef, useState } from "react";
import { request } from "../api";
import { getCache } from "../cache";
import { readAccounts } from "../accountStorage";
import type { Account, Message, View } from "../types";
import {
  nativeNotifications,
  nativeMessage,
  synchronizeNativeAccounts,
} from "./native";
export type NotificationTarget = {
  accountId: string;
  messageId: number;
  view: View;
  nonce: number;
};
export function validNotificationTarget(
  value: unknown,
): value is { accountId: string; messageId: number } {
  if (!value || typeof value !== "object") return false;
  const d = value as { accountId: unknown; messageId: unknown };
  return (
    typeof d.accountId === "string" &&
    d.accountId.length <= 2048 &&
    Number.isSafeInteger(d.messageId) &&
    Number(d.messageId) > 0
  );
}
export function messageView(message: Message, account: Account): View {
  if (message.type === "stream" && Number.isSafeInteger(message.stream_id))
    return {
      type: "channel",
      channelId: message.stream_id!,
      topic: message.subject,
    };
  if (message.type === "private" && Array.isArray(message.display_recipient)) {
    const ids = message.display_recipient
      .map((u) => u.id)
      .filter((id) => id !== account.userId);
    return { type: "dm", userIds: ids.length ? ids : [account.userId] };
  }
  throw new Error("The notification has no accessible conversation.");
}
export function useNotificationNavigation(
  accounts: Account[],
  selectAccount: (id: string) => void,
  onError: (error: string) => void,
) {
  const [target, setTarget] = useState<NotificationTarget>();
  const current = useRef({ accounts, selectAccount, onError });
  current.current = { accounts, selectAccount, onError };
  useEffect(() => {
    synchronizeNativeAccounts(accounts);
  }, [accounts]);
  useEffect(() => {
    let controller: AbortController | undefined;
    const open = async (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!validNotificationTarget(detail)) return;
      const account = current.current.accounts.find(
        (a) => a.id === detail.accountId,
      );
      if (!account) {
        current.current.onError(
          "This notification belongs to a removed account.",
        );
        return;
      }
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      current.current.onError("Opening notification…");
      try {
        const result = await request<{ message: Message }>(
          account,
          `/messages/${detail.messageId}`,
          { apply_markdown: true },
          "GET",
          signal,
        );
        if (
          signal.aborted ||
          !readAccounts().some(
            (a) => a.id === account.id && a.apiKey === account.apiKey,
          )
        )
          return;
        const view = messageView(result.message, account);
        // Seed the existing bounded cache's anchor contract; B can preserve this when integrating search navigation.
        const cache = getCache(account),
          ui = cache.ui(view);
        ui.anchorId = detail.messageId;
        ui.anchorTop = 0;
        ui.atBottom = false;
        await cache.load(view, true, detail.messageId);
        if (
          signal.aborted ||
          !readAccounts().some(
            (a) => a.id === account.id && a.apiKey === account.apiKey,
          )
        )
          return;
        current.current.selectAccount(account.id);
        setTarget({ ...detail, view, nonce: Date.now() });

        current.current.onError("");
      } catch (e) {
        if (!signal.aborted)
          current.current.onError(
            e instanceof Error
              ? e.message
              : "The notification is no longer accessible.",
          );
      }
    };
    const ready = () => nativeMessage({ op: "ready" });
    const native = nativeNotifications();
    if (native)
      native.onmessage = (event) => {
        try {
          const detail = JSON.parse(event.data);
          if (validNotificationTarget(detail))
            window.dispatchEvent(
              new CustomEvent("zoomerlip-notification-open", { detail }),
            );
          else if (typeof detail.permission === "string")
            window.dispatchEvent(
              new CustomEvent("zoomerlip-notification-permission", {
                detail: detail.permission,
              }),
            );
        } catch {
          /* Invalid native message. */
        }
      };
    window.addEventListener("zoomerlip-notification-open", open);
    window.addEventListener("zoomerlip-native-ready", ready);
    ready();
    return () => {
      controller?.abort();
      window.removeEventListener("zoomerlip-notification-open", open);
      window.removeEventListener("zoomerlip-native-ready", ready);
      if (native) native.onmessage = undefined;
    };
  }, []);
  return target;
}
