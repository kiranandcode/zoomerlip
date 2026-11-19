import { useEffect, useState } from "react";
import type { ZulipEvent } from "../types";
type Listener = (events?: ZulipEvent[]) => void;
// No retained account data. Unmounted consumers remove their listeners.
const listeners = new Map<string, Set<Listener>>();
const permissionEvents = new Set([
  "subscription",
  "stream",
  "realm",
  "realm_user",
  "user_group",
]);
const contentEvents = new Set([
  ...permissionEvents,
  "update_message",
  "delete_message",
  "update_message_flags",
  "user_topic",
  "realm_user_settings_defaults",
]);
export function invalidateOrganisation(
  accountId: string,
  events?: ZulipEvent[],
) {
  if (events && !events.some((e) => contentEvents.has(e.type))) return;
  listeners.get(accountId)?.forEach((listener) => listener(events));
}
export function useOrganisationRevision(
  accountId: string,
  scope: "all" | "permissions" = "all",
) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const listener: Listener = (events) => {
      if (
        !events ||
        scope === "all" ||
        events.some((e) => permissionEvents.has(e.type))
      )
        setRevision((n) => n + 1);
    };
    const set = listeners.get(accountId) || new Set<Listener>();
    set.add(listener);
    listeners.set(accountId, set);
    return () => {
      set.delete(listener);
      if (!set.size) listeners.delete(accountId);
    };
  }, [accountId, scope]);
  return revision;
}
