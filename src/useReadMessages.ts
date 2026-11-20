import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { request } from "./api";
import { trackReadMessages } from "./readMessages";
import type { Account, Message, View } from "./types";

export function useReadMessages(
  account: Account,
  view: View,
  root: RefObject<HTMLDivElement | null>,
  messages: Message[],
  enabled: boolean,
  onError: (message: string) => void,
) {
  const current = useRef({ messages, enabled, onError });
  current.current = { messages, enabled, onError };
  const tracking = useRef<ReturnType<typeof trackReadMessages> | undefined>(
    undefined,
  );
  const key = JSON.stringify(view);
  useEffect(() => {
    if (!root.current || view.type === "home" || view.type === "profile")
      return;
    const tracker = trackReadMessages(
      root.current,
      () =>
        new Set(
          current.current.messages
            .filter((m) => !m.flags?.includes("read"))
            .map((m) => m.id),
        ),
      (ids, signal) =>
        request(
          account,
          "/messages/flags",
          {
            messages: ids,
            flag: "read",
            op: "add",
          },
          "POST",
          signal,
        ),
      () =>
        current.current.onError(
          "Could not save read status. Retrying when connected.",
        ),
      () => current.current.enabled,
    );
    tracking.current = tracker;
    return () => {
      tracker.dispose();
      tracking.current = undefined;
    };
  }, [account.id, account.apiKey, account.url, account.email, key, root]);
  useEffect(() => {
    tracking.current?.refresh();
  }, [messages, enabled]);
}
