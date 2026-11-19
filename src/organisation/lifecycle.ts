import { useEffect, useState } from "react";
import type { ZulipEvent } from "../types";
// No retained account data. Unmounted consumers remove their listeners.
const listeners = new Map<string, Set<() => void>>();
export function invalidateOrganisation(
  accountId: string,
  events?: ZulipEvent[],
) {
  if (
    events &&
    !events.some((e) =>
      [
        "update_message",
        "delete_message",
        "update_message_flags",
        "subscription",
        "stream",
        "realm",
        "realm_user",
        "user_group",
        "user_topic",
      ].includes(e.type),
    )
  )
    return;
  listeners.get(accountId)?.forEach((listener) => listener());
}
export function useOrganisationRevision(accountId: string) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const listener = () => setRevision((n) => n + 1);
    const set = listeners.get(accountId) || new Set();
    set.add(listener);
    listeners.set(accountId, set);
    return () => {
      set.delete(listener);
      if (!set.size) listeners.delete(accountId);
    };
  }, [accountId]);
  return revision;
}
