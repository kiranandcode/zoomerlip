import { request, ApiError } from "../api";
import { demoAccount } from "../demo/account";
import { messagingStreamAllowed } from "./capabilities";
import type { Account, View } from "../types";

export type Destination = Extract<View, { type: "channel" | "dm" }>;
export type Draft = {
  id: string;
  view: Destination;
  text: string;
  topic: string;
  updated: number;
  serverId?: number;
};
const prefix = "zoomerlip.draft.v1.";
const demoDrafts = new Map<string, Draft>();
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
    (p.serverId === undefined || positive(p.serverId)) &&
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
function readDraftRecords(account: string): Draft[] {
  if (account === demoAccount.id)
    return [...demoDrafts.values()]
      .map((d) => structuredClone(d))
      .sort((a, b) => b.updated - a.updated);
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
export function listDrafts(account: string): Draft[] {
  try {
    return readDraftRecords(account);
  } catch {
    return [];
  }
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
  if (account === demoAccount.id)
    demoDrafts.set(draft.id, structuredClone(draft));
  else localStorage.setItem(key(account, draft.id), encoded);
}
export function deleteDraft(account: string, id: string) {
  if (account === demoAccount.id) {
    demoDrafts.delete(id);
    return;
  }
  localStorage.removeItem(key(account, id));
}
export function clearDrafts(account: string, streams?: number[]) {
  if (account === demoAccount.id) {
    for (const [id, d] of demoDrafts)
      if (
        !streams ||
        (d.view.type === "channel" && streams.includes(d.view.channelId))
      )
        demoDrafts.delete(id);
    return;
  }
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
export function persistDraft(
  account: string,
  draft: Draft,
  expected?: string,
  expectedTopic?: string,
) {
  const old = listDrafts(account).find((d) => d.id === draft.id);
  if (
    old &&
    expected !== undefined &&
    (old.text !== expected ||
      (expectedTopic !== undefined && old.topic !== expectedTopic)) &&
    (old.text !== draft.text || old.topic !== draft.topic)
  )
    saveDraft(account, { ...old, id: crypto.randomUUID() });
  if (draft.text.trim()) saveDraft(account, draft);
  else deleteDraft(account, draft.id);
}
export function moveDrafts(
  account: string,
  from: Extract<Destination, { type: "channel" }>,
  to: Extract<Destination, { type: "channel" }>,
) {
  for (const d of listDrafts(account)) {
    if (
      d.view.type !== "channel" ||
      d.view.channelId !== from.channelId ||
      d.topic.toLowerCase() !== from.topic?.toLowerCase()
    )
      continue;
    const view = {
      ...to,
      ...(d.view.topic === undefined ? { topic: undefined } : {}),
    };
    const canonical = d.id === destinationKey(d.view);
    const id = canonical ? destinationKey(view) : d.id;
    const old = listDrafts(account).find((d) => d.id === id);
    const targetId =
      old && old.id !== d.id && old.text !== d.text ? crypto.randomUUID() : id;
    saveDraft(account, {
      ...d,
      id: targetId,
      view,
      topic: to.topic || "",
      updated: Date.now(),
    });
    if (d.id !== targetId) deleteDraft(account, d.id);
  }
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
  if (
    !data.drafts.every(
      (d) =>
        d &&
        positive(d.id) &&
        ["stream", "private"].includes(d.type) &&
        Array.isArray(d.to) &&
        (d.type !== "stream" || d.to.length === 1),
    )
  )
    throw new Error(
      "Server returned unsupported drafts. Local drafts are unchanged.",
    );
  const remote: Draft[] = data.drafts.map((d) => ({
    id: `server:${d.id}`,
    serverId: d.id,
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
    if (
      d.view.type === "channel" &&
      !messagingStreamAllowed(account.id, d.view.channelId)
    )
      continue;
    if (!seen.has(fingerprint(d))) {
      saveDraft(account.id, { ...d, id: crypto.randomUUID() });
      seen.add(fingerprint(d));
    }
  }
  const existing = new Set(remote.map(fingerprint));
  const missing = local.filter(
    (d) =>
      !existing.has(fingerprint(d)) &&
      (d.view.type !== "channel" ||
        messagingStreamAllowed(account.id, d.view.channelId)),
  );
  if (missing.length && !signal.aborted) {
    const created = await request<{ ids: number[] }>(
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
    if (
      !signal.aborted &&
      Array.isArray(created.ids) &&
      created.ids.length === missing.length
    ) {
      for (const [i, d] of missing.entries()) {
        const current = listDrafts(account.id).find((v) => v.id === d.id);
        if (
          current &&
          fingerprint(current) === fingerprint(d) &&
          positive(created.ids[i])
        )
          saveDraft(account.id, { ...current, serverId: created.ids[i] });
      }
    }
  }
}
