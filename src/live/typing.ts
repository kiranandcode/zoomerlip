import { useEffect, useMemo } from "react";
import { request } from "../api";
import type { Account, View } from "../types";
import { conversationKey, liveStore } from "./store";

/** No repeating start timer: only real compose input can renew typing. */
export class TypingSender {
  private started = false;
  private last = -Infinity;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private chain = Promise.resolve();
  constructor(
    private send: (op: "start" | "stop") => Promise<unknown>,
    private startMs: number,
    private stopMs: number,
  ) {}
  input() {
    if (this.stopped) return;
    if (Date.now() - this.last >= this.startMs || !this.started) {
      this.started = true;
      this.last = Date.now();
      this.enqueue("start");
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.stop(), this.stopMs);
  }
  private enqueue(op: "start" | "stop") {
    this.chain = this.chain
      .then(() => this.send(op))
      .then(
        () => {},
        () => {},
      );
  }
  stop() {
    clearTimeout(this.timer);
    if (this.started) {
      this.started = false;
      this.enqueue("stop");
    }
  }
  resume() {
    this.stopped = false;
  }
  dispose() {
    this.stop();
    this.stopped = true;
  }
}
export function useTyping(account: Account, view: View, topic: string) {
  const key = conversationKey(
    view.type === "channel" ? { ...view, topic } : view,
    account.userId,
  );
  const sender = useMemo(() => {
    const state = liveStore(account.id).state;
    return new TypingSender(
      async (op) => {
        const current = liveStore(account.id).state;
        if (!current.ready) return;
        if (view.type === "channel") {
          if (
            current.featureLevel < 58 ||
            !topic.trim() ||
            current.settings.send_stream_typing_notifications === false
          )
            return;
          return request(
            account,
            "/typing",
            { op, type: "stream", stream_id: view.channelId, topic },
            "POST",
            undefined,
            5000,
          );
        }
        if (
          view.type === "dm" &&
          current.settings.send_private_typing_notifications !== false
        )
          return request(
            account,
            "/typing",
            {
              op,
              to: view.userIds,
              ...(current.featureLevel >= 174 ? { type: "direct" } : {}),
            },
            "POST",
            undefined,
            5000,
          );
      },
      state.startMs,
      state.stopMs,
    );
    // Destination identity includes topic, recipients and account credentials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, account.apiKey, key]);
  useEffect(() => {
    sender.resume();
    const stop = () => sender.stop();
    const hidden = () => {
      if (document.visibilityState !== "visible") stop();
    };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      sender.dispose();
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [sender]);
  return sender;
}
