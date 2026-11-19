import type { Account, ZulipEvent } from "../types";
import { clearDrafts } from "./drafts";
// UI modules subscribe to invalidation, not credentials or unbounded event history.
export function messagingEvent(account: Account, events: ZulipEvent[]) {
  window.dispatchEvent(
    new CustomEvent("zoomerlip-messaging", {
      detail: { accountId: account.id, events },
    }),
  );
}
export function invalidateMessaging(accountId: string, streams?: number[]) {
  if (typeof window === "undefined") return;
  try {
    clearDrafts(accountId, streams);
  } catch { /* Storage denial must not prevent revoking in-memory access. */
  } finally {
    window.dispatchEvent(
      new CustomEvent("zoomerlip-messaging-reset", {
        detail: { accountId, streams },
      }),
    );
  }
}
