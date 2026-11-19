import { request } from "../api";
import type { Account } from "../types";
import { deleteDraft, destinationKey, draftFor } from "./drafts";
import type { Destination } from "./drafts";
const pending = new Set<string>();
// A deliberate send survives navigation, but never account/access invalidation.
// No timers, replay queue or mutation retries are used.
export async function sendComposition(
  account: Account,
  view: Destination,
  text: string,
  topic: string,
) {
  const key = `${account.id}:${destinationKey(view)}`;
  if (pending.has(key))
    throw new Error(
      "A send to this destination is still pending. Check delivery before retrying.",
    );
  if (pending.size >= 20)
    throw new Error(
      "Too many pending sends. Wait for delivery before retrying.",
    );
  pending.add(key);
  const control = new AbortController();
  const reset = (e: Event) => {
    const d = (e as CustomEvent).detail;
    if (
      d.accountId === account.id &&
      (!d.streams ||
        (view.type === "channel" && d.streams.includes(view.channelId)))
    )
      control.abort();
  };
  window.addEventListener("zoomerlip-messaging-reset", reset);
  try {
    await request(
      account,
      "/messages",
      view.type === "channel"
        ? { type: "stream", to: view.channelId, topic, content: text }
        : { type: "private", to: view.userIds, content: text },
      "POST",
      control.signal,
    );
    if (control.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const current = draftFor(account.id, view);
    if (current?.text === text && current.topic.trim() === topic)
      deleteDraft(account.id, current.id);
    window.dispatchEvent(
      new CustomEvent("zoomerlip-draft-sent", {
        detail: {
          accountId: account.id,
          destination: destinationKey(view),
          text,
        },
      }),
    );
  } finally {
    pending.delete(key);
    window.removeEventListener("zoomerlip-messaging-reset", reset);
  }
}
