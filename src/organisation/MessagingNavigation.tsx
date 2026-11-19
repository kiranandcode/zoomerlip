/// <reference types="vite/client" />
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { getCache } from "../cache";
import type { Account, View } from "../types";
import { useOrganisationRevision } from "./lifecycle";
type Destination = Extract<View, { type: "channel" | "dm" }>;
type Draft = {
  id: string;
  view: Destination;
  text: string;
  topic: string;
  updated: number;
};
// Workstream A owns these modules. Vite resolves the optional modules when the
// parent integrates A, without copying them or changing Composer's interface.
const modules = import.meta.glob([
  "../messaging/DraftList.tsx",
  "../messaging/drafts.ts",
  "../messaging/ProductivityPanel.tsx",
  "../messaging/messaging.css",
]);
const draftsPath = "../messaging/DraftList.tsx",
  productivityPath = "../messaging/ProductivityPanel.tsx";
export const messagingViews = {
  drafts: !!modules[draftsPath] && !!modules["../messaging/drafts.ts"],
  scheduled: !!modules[productivityPath],
};
type DraftProps = {
  account: Account;
  onRestore: (draft: Draft) => void;
  onClose: () => void;
};
type ScheduledProps = {
  account: Account;
  kind: "scheduled_messages";
  view: Destination;
  text: string;
  topic: string;
  onInsert: (text: string) => void;
  onClose: () => void;
};
const DraftList = lazy(async () => ({
  default: (
    (await modules[draftsPath]()) as { DraftList: ComponentType<DraftProps> }
  ).DraftList,
}));
const ProductivityPanel = lazy(async () => ({
  default: (
    (await modules[productivityPath]()) as {
      ProductivityPanel: ComponentType<ScheduledProps>;
    }
  ).ProductivityPanel,
}));
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
  useEffect(() => {
    void modules["../messaging/messaging.css"]?.();
  }, []);
  const destination: Destination =
    view.type === "channel" || view.type === "dm"
      ? view
      : { type: "dm", userIds: [account.userId] };
  async function restore(draft: Draft) {
    const control = lifetime.current;
    try {
      const helpers = (await modules["../messaging/drafts.ts"]()) as {
        saveDraft: (id: string, draft: Draft) => void;
        destinationKey: (view: Destination) => string;
        listDrafts: (id: string) => Draft[];
      };
      if (control.signal.aborted) return;
      if (
        draft.view.type === "channel" &&
        !channelIds.includes(draft.view.channelId)
      )
        throw new Error("This draft’s channel is no longer available.");
      const cache = getCache(account),
        target = cache.ui(draft.view);
      const existing = helpers
        .listDrafts(account.id)
        .find((d) => d.id === helpers.destinationKey(draft.view));
      if (
        existing &&
        (existing.text !== draft.text || existing.topic !== draft.topic)
      )
        helpers.saveDraft(account.id, { ...existing, id: crypto.randomUUID() });
      if (
        target.text.trim() &&
        (target.text !== draft.text || target.topic !== draft.topic)
      )
        helpers.saveDraft(account.id, {
          id: crypto.randomUUID(),
          view: draft.view,
          text: target.text,
          topic: target.topic,
          updated: Date.now(),
        });
      helpers.saveDraft(account.id, {
        ...draft,
        id: helpers.destinationKey(draft.view),
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
      <Suspense fallback={<p role="status">Loading…</p>}>
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
      </Suspense>
    </section>
  );
}
