import { useEffect, useRef, useState } from "react";
import { getCache } from "../cache";
import type { Account, View } from "../types";
import { DraftList } from "../messaging/DraftList";
import { ProductivityPanel } from "../messaging/ProductivityPanel";
import { saveDraft, destinationKey, listDrafts } from "../messaging/drafts";
import type { Draft, Destination } from "../messaging/drafts";
import "../messaging/messaging.css";
import { useOrganisationRevision } from "./lifecycle";
export const messagingViews = { drafts: true, scheduled: true };
export function MessagingNavigation({
  account,
  view,
  kind,
  onSelect,
  onClose,
  channelIds,
}: {
  account: Account;
  view: View;
  kind: "drafts" | "scheduled";
  onSelect: (view: View) => void;
  onClose: () => void;
  channelIds: number[];
}) {
  const [error, setError] = useState("");
  const revision = useOrganisationRevision(account.id, "permissions");
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    lifetime.current = new AbortController();
    return () => lifetime.current.abort();
  }, [revision]);
  const destination: Destination =
    view.type === "channel" || view.type === "dm"
      ? view
      : { type: "dm", userIds: [account.userId] };
  function restore(draft: Draft) {
    const control = lifetime.current;
    try {
      if (control.signal.aborted) return;
      if (
        draft.view.type === "channel" &&
        !channelIds.includes(draft.view.channelId)
      )
        throw new Error("This draft’s channel is no longer available.");
      const cache = getCache(account),
        target = cache.ui(draft.view);
      const existing = listDrafts(account.id).find(
        (d) => d.id === destinationKey(draft.view),
      );
      if (
        existing &&
        (existing.text !== draft.text || existing.topic !== draft.topic)
      )
        saveDraft(account.id, { ...existing, id: crypto.randomUUID() });
      if (
        target.text.trim() &&
        (target.text !== draft.text || target.topic !== draft.topic)
      )
        saveDraft(account.id, {
          id: crypto.randomUUID(),
          view: draft.view,
          text: target.text,
          topic: target.topic,
          updated: Date.now(),
        });
      saveDraft(account.id, {
        ...draft,
        id: destinationKey(draft.view),
      });
      target.text = draft.text;
      target.topic = draft.topic;
      onSelect(draft.view);
    } catch (e) {
      if (!control.signal.aborted) setError((e as Error).message);
    }
  }
  return (
    <section
      className="organisation-panel"
      aria-label={
        kind === "drafts" ? "Draft navigation" : "Scheduled navigation"
      }
    >
      {error && <p role="alert">{error}</p>}

      {kind === "drafts" ? (
        <DraftList
          key={revision}
          account={account}
          onRestore={(draft) => void restore(draft)}
          onClose={onClose}
        />
      ) : (
        <ProductivityPanel
          key={revision}
          account={account}
          kind="scheduled_messages"
          view={destination}
          text={getCache(account).ui(destination).text}
          topic={
            destination.type === "channel"
              ? destination.topic || getCache(account).ui(destination).topic
              : ""
          }
          onInsert={() => {}}
          onClose={onClose}
        />
      )}
    </section>
  );
}
