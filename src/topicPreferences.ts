import { useMemo, useSyncExternalStore } from "react";
import { topicKey } from "./sessionModel";
const prefix = "zoomerlip.thread.v1.";
export type ThreadMute = { until: number | null };
let revision = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
function schedule() {
  clearTimeout(timer);
  if (!listeners.size) return;
  let next = Infinity;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) || "{}");
        if (typeof value.until === "number" && value.until > Date.now())
          next = Math.min(next, value.until);
      } catch {
        /* Ignore corrupt record. */
      }
    }
  } catch {
    /* Storage can be disabled. */
  }
  if (Number.isFinite(next))
    timer = setTimeout(
      notify,
      Math.min(2147483647, Math.max(1, next - Date.now())),
    );
}
function notify() {
  revision++;
  listeners.forEach((fn) => fn());
  schedule();
}
function storage(e: StorageEvent) {
  if (e.key === null || e.key.startsWith(prefix)) notify();
}
function subscribe(fn: () => void) {
  if (!listeners.size) window.addEventListener("storage", storage);
  listeners.add(fn);
  schedule();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      window.removeEventListener("storage", storage);
      clearTimeout(timer);
    }
  };
}
const cached = new Map<
  string,
  { revision: number; expires: number; mutes: Record<string, ThreadMute> }
>();
/** readThreadMutes, rescanning storage only after a mute change or expiry. */
export function currentThreadMutes(accountId: string) {
  const hit = cached.get(accountId);
  if (hit && hit.revision === revision && hit.expires > Date.now())
    return hit.mutes;
  const mutes = readThreadMutes(accountId);
  let expires = Infinity;
  for (const mute of Object.values(mutes))
    if (mute.until !== null) expires = Math.min(expires, mute.until);
  cached.set(accountId, { revision, expires, mutes });
  return mutes;
}
export function readThreadMutes(accountId: string): Record<string, ThreadMute> {
  const result: Record<string, ThreadMute> = {},
    start = prefix + encodeURIComponent(accountId) + ".";
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(start)) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) || "{}");
        if (
          value.until === null ||
          (typeof value.until === "number" && value.until > Date.now())
        )
          result[decodeURIComponent(key.slice(start.length))] = {
            until: value.until,
          };
      } catch {
        /* Ignore corrupt entry. */
      }
    }
  } catch {
    /* No persistence. */
  }
  return result;
}
/** Deletes an account's thread mutes, which name its streams and topics. */
export function clearThreadMutes(accountId: string) {
  const start = prefix + encodeURIComponent(accountId) + ".";
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(start)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* No persistence. */
  }
  cached.delete(accountId);
  notify();
}
export function setThreadMute(
  accountId: string,
  streamId: number,
  topic: string,
  duration: number | null | "off",
) {
  const key =
    prefix +
    encodeURIComponent(accountId) +
    "." +
    encodeURIComponent(topicKey(streamId, topic));
  try {
    if (duration === "off") localStorage.removeItem(key);
    else
      localStorage.setItem(
        key,
        JSON.stringify({
          until: duration === null ? null : Date.now() + duration,
        }),
      );
  } catch {
    throw new Error("Could not save the thread mute in browser storage.");
  }
  notify();
}
export function useThreadMutes(accountId: string) {
  const version = useSyncExternalStore(subscribe, () => revision);
  return useMemo(() => currentThreadMutes(accountId), [accountId, version]);
}
export function useThreadMuteVersion() {
  return useSyncExternalStore(subscribe, () => revision);
}
