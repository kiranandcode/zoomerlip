import { request, ApiError } from "../api";
import type { Account, View } from "../types";

export type Destination = Extract<View, { type: "channel" | "dm" }>;
export type Draft = {
  id: string;
  view: Destination;
  text: string;
  topic: string;
  updated: number;
};
const prefix = "zoomerlip.draft.v1.";
export const MAX_DRAFTS = 100,
  MAX_DRAFT_TEXT = 100000,
  MAX_DRAFT_BYTES = 2_000_000;
const scope = (id: string) => prefix + encodeURIComponent(id) + ".";
const key = (account: string, id: string) =>
  scope(account) + encodeURIComponent(id);
export const destinationKey = (view: Destination) =>
  view.type === "channel"
    ? JSON.stringify(["channel", view.channelId, view.topic ?? ""])
    : JSON.stringify(["dm", [...new Set(view.userIds)].sort((a, b) => a - b)]);
const positive = (n: unknown) => Number.isSafeInteger(n) && Number(n) > 0;
export function validDraft(d: unknown): d is Draft {
  if (!d || typeof d !== "object") return false;
  const p = d as Draft,
    v = p.view;
  return (
    typeof p.id === "string" &&
    p.id.length < 1000 &&
    typeof p.text === "string" &&
    p.text.length <= MAX_DRAFT_TEXT &&
    !p.text.includes("\0") &&
    typeof p.topic === "string" &&
    p.topic.length <= 1000 &&
    !p.topic.includes("\0") &&
    Number.isFinite(p.updated) &&
    !!v &&
    (v.type === "channel"
      ? positive(v.channelId) &&
        (v.topic === undefined ||
          (typeof v.topic === "string" && v.topic.length <= 1000))
      : v.type === "dm" &&
        Array.isArray(v.userIds) &&
        v.userIds.length > 0 &&
        v.userIds.length <= 100 &&
        v.userIds.every(positive))
  );
}
export function listDrafts(account: string): Draft[] {
  const result: Draft[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(scope(account))) continue;
    const raw = localStorage.getItem(k) || "";
    if (raw.length > MAX_DRAFT_BYTES) continue;
    try {
      const d: unknown = JSON.parse(raw);
      if (validDraft(d)) result.push(d);
    } catch {
      /* Skip corrupt records. */
    }
    if (result.length >= MAX_DRAFTS) break;
  }
  return result.sort((a, b) => b.updated - a.updated);
}
export function saveDraft(account: string, draft: Draft) {
  if (!validDraft(draft))
    throw new Error(
      "Draft exceeds the local size limit or contains invalid data.",
    );
  const records = listDrafts(account).filter((d) => d.id !== draft.id);
  const encoded = JSON.stringify(draft);
  if (
    records.length >= MAX_DRAFTS ||
    records.reduce(
      (n, d) => n + JSON.stringify(d).length * 2,
      encoded.length * 2,
    ) > MAX_DRAFT_BYTES
  )
    throw new Error(
      "Draft storage is full. Delete or sync drafts before saving more.",
    );
  localStorage.setItem(key(account, draft.id), encoded);
}
export function deleteDraft(account: string, id: string) {
  localStorage.removeItem(key(account, id));
}
export function clearDrafts(account: string, streams?: number[]) {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(scope(account))) keys.push(k);
  }
  for (const k of keys) {
    if (!streams) localStorage.removeItem(k);
    else {
      try {
        const d = JSON.parse(localStorage.getItem(k) || "null");
        if (
          !validDraft(d) ||
          (d.view.type === "channel" && streams.includes(d.view.channelId))
        )
          localStorage.removeItem(k);
      } catch {
        localStorage.removeItem(k);
      }
    }
  }
}
export function draftFor(account: string, view: Destination) {
  return listDrafts(account).find((d) => d.id === destinationKey(view));
}
// Preserve a second tab's version rather than overwriting it silently.
export function persistDraft(account: string, draft: Draft, expected?: string) {
  const old = listDrafts(account).find((d) => d.id === draft.id);
  if (
    old &&
    expected !== undefined &&
    old.text !== expected &&
    old.text !== draft.text
  )
    saveDraft(account, { ...old, id: crypto.randomUUID() });
  if (draft.text.trim()) saveDraft(account, draft);
  else deleteDraft(account, draft.id);
}
type ServerDraft = {
  id: number;
  type: string;
  to: number[];
  topic: string;
  content: string;
  timestamp: number;
};
const fingerprint = (d: Draft) =>
  JSON.stringify([
    d.view.type === "channel"
      ? [d.view.channelId]
      : [...d.view.userIds].sort((a, b) => a - b),
    d.view.type,
    d.topic,
    d.text,
  ]);
export async function syncDrafts(account: Account, signal: AbortSignal) {
  let data: { drafts: ServerDraft[] };
  try {
    data = await request(account, "/drafts", {}, "GET", signal);
  } catch (e) {
    if (e instanceof ApiError && [400, 404, 405].includes(e.status))
      throw new Error(
        "Server draft sync is unavailable. Local drafts remain saved.",
      );
    throw e;
  }
  if (!Array.isArray(data.drafts) || data.drafts.length > MAX_DRAFTS)
    throw new Error("Too many server drafts. Manage them before syncing.");
  const remote: Draft[] = data.drafts.map((d) => ({
    id: `server:${d.id}`,
    view:
      d.type === "stream"
        ? { type: "channel", channelId: d.to?.[0], topic: d.topic }
        : { type: "dm", userIds: d.to },
    text: d.content,
    topic: d.topic,
    updated: d.timestamp * 1000,
  }));
  if (!remote.every(validDraft))
    throw new Error(
      "Server returned unsupported or invalid drafts. Local drafts are unchanged.",
    );
  const local = listDrafts(account.id),
    seen = new Set(local.map(fingerprint));
  for (const d of remote) {
    if (signal.aborted) return;
    if (!seen.has(fingerprint(d))) {
      saveDraft(account.id, { ...d, id: crypto.randomUUID() });
      seen.add(fingerprint(d));
    }
  }
  const existing = new Set(remote.map(fingerprint));
  const missing = local.filter((d) => !existing.has(fingerprint(d)));
  if (missing.length && !signal.aborted)
    await request(
      account,
      "/drafts",
      {
        drafts: missing.map((d) => ({
          type: d.view.type === "channel" ? "stream" : "private",
          to: d.view.type === "channel" ? [d.view.channelId] : d.view.userIds,
          topic: d.topic,
          content: d.text,
          timestamp: Math.floor(d.updated / 1000),
        })),
      },
      "POST",
      signal,
    );
}
