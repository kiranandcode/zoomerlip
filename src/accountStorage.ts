import { clearNotificationPreferences } from "./notifications/preferences";
import { clearThreadMutes } from "./topicPreferences";
import type { Account } from "./types";
export const legacyAccountKey = "zoomerlip.accounts.v1";
export const accountPrefix = "zoomerlip.account.v2.";
export function validAccount(a: unknown): a is Account {
  if (!a || typeof a !== "object") return false;
  const p = a as Account;
  try {
    const u = new URL(p.url);
    return (
      typeof p.id === "string" &&
      p.id === `${u.origin}|${p.userId}` &&
      typeof p.email === "string" &&
      typeof p.apiKey === "string" &&
      typeof p.name === "string" &&
      Number.isInteger(p.userId) &&
      u.origin === p.url &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}
export function readAccounts(): Account[] {
  try {
    const records = new Map<string, Account>();
    let legacy: unknown = [];
    try {
      legacy = JSON.parse(localStorage.getItem(legacyAccountKey) || "[]");
    } catch {
      /* Recover individually stored accounts. */
    }
    if (Array.isArray(legacy))
      for (const a of legacy) if (validAccount(a)) records.set(a.id, a);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(accountPrefix)) continue;
      let id: string;
      try {
        id = decodeURIComponent(key.slice(accountPrefix.length));
        // One canonical key per account prevents an encoded alias from
        // overriding a removal tombstone later in the iteration.
        if (key !== accountPrefix + encodeURIComponent(id)) continue;
      } catch {
        // A malformed key is one corrupt record, not a corrupt account store.
        continue;
      }
      try {
        const record = JSON.parse(localStorage.getItem(key) || "null");
        if (record === null) records.delete(id);
        else if (validAccount(record) && record.id === id)
          records.set(id, record);
      } catch {
        records.delete(id);
      }
    }
    return [...records.values()];
  } catch {
    return [];
  }
}
// Each operation touches one account record. A stale tab adding B cannot restore A.
// Removal tombstones also dominate an old v1 client still writing its saved list.
export function putAccount(account: Account) {
  if (!validAccount(account)) throw new Error("Invalid account.");
  localStorage.setItem(
    accountPrefix + encodeURIComponent(account.id),
    JSON.stringify(account),
  );
  window.dispatchEvent(new Event("zoomerlip-accounts"));
}
export function removeAccount(id: string) {
  localStorage.setItem(accountPrefix + encodeURIComponent(id), "null");
  try {
    const legacy = JSON.parse(localStorage.getItem(legacyAccountKey) || "[]");
    if (Array.isArray(legacy))
      localStorage.setItem(
        legacyAccountKey,
        JSON.stringify(legacy.filter((a) => a?.id !== id)),
      );
  } catch {
    /* Tombstone still revokes the session. */
  }
  clearThreadMutes(id);
  clearNotificationPreferences(id);
  window.dispatchEvent(new Event("zoomerlip-accounts"));
}
export function accountStorageEvent(e: StorageEvent) {
  return (
    e.key === null ||
    e.key === legacyAccountKey ||
    !!e.key?.startsWith(accountPrefix)
  );
}
