import { useEffect, useState } from "react";
import { getCache } from "./cache";
import { clearUploadCache } from "./uploads";
import { ApiError, pause, request } from "./api";
import { initialSession, SessionModel } from "./sessionModel";
import type { Registration, Session } from "./sessionModel";
import type { Account, ZulipEvent } from "./types";
export type { Session } from "./sessionModel";
export function useSession(account: Account, _active: boolean): Session {
  const [state, setState] = useState<Session>(initialSession);
  useEffect(() => {
    const lifetime = new AbortController(),
      signal = lifetime.signal,
      cache = getCache(account),
      model = new SessionModel();
    let queue = "",
      last = -1,
      retry = 0,
      longpollMs = 90000,
      poll: AbortController | undefined,
      probe = true,
      finished = false;
    const status = (value: string, error = "") => {
      if (model.state.status === value && model.state.error === error) return;
      model.state = { ...model.state, status: value, error };
      setState(model.state);
    };
    const lock = (message: string) => {
      cache.lock();
      clearUploadCache(account.id);
      model.state = {
        ...initialSession,
        status: "Sign in again",
        error: message,
        locked: true,
      };
      setState(model.state);
      finished = true;
      poll?.abort();
    };
    const authFailed = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (
        d?.url === account.url &&
        d?.email === account.email &&
        d?.apiKey === account.apiKey
      )
        lock(
          "Your credentials are no longer valid. Remove this organization and sign in again.",
        );
    };
    const wake = () => {
      if (document.visibilityState === "visible" && !finished) {
        probe = true;
        poll?.abort();
      }
    };
    window.addEventListener("zoomerlip-auth-failed", authFailed);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    async function run() {
      while (!signal.aborted && !finished) {
        try {
          if (!queue) {
            const previous = model.state.channels.map((c) => c.stream_id);
            const data = await request<Registration>(
              account,
              "/register",
              {
                event_types: [
                  "message",
                  "update_message",
                  "delete_message",
                  "reaction",
                  "subscription",
                  "stream",
                  "realm_user",
                  "realm",
                  "update_message_flags",
                  "muted_users",
                  "user_topic",
                ],
                fetch_event_types: [
                  "subscription",
                  "realm_user",
                  "realm",
                  "muted_users",
                  "user_topic",
                  "recent_private_conversations",
                  "message",
                  "update_message_flags",
                ],
                apply_markdown: true,
                client_gravatar: false,
              },
              "POST",
              signal,
            );
            if (signal.aborted || finished) break;
            queue = data.queue_id;
            last = data.last_event_id;
            longpollMs =
              typeof data.event_queue_longpoll_timeout_seconds === "number"
                ? Math.max(
                    1000,
                    data.event_queue_longpoll_timeout_seconds * 1000,
                  )
                : 90000;
            model.register(data, account.name);
            cache.unlock();
            const registered = new Set(
              model.state.channels.map((c) => c.stream_id),
            );
            cache.purgeStreams(previous.filter((id) => !registered.has(id)));
            cache.allowStreams(model.state.channels.map((c) => c.stream_id));
            cache.setMutedUsers(model.state.mutedUsers);
            cache.invalidate();
            setState(model.state);
            probe = true;
          }
          poll = new AbortController();
          const abort = () => poll?.abort();
          signal.addEventListener("abort", abort, { once: true });
          let data: { events: ZulipEvent[] };
          try {
            data = await request(
              account,
              "/events",
              { queue_id: queue, last_event_id: last, dont_block: probe },
              "GET",
              poll.signal,
              longpollMs,
            );
          } finally {
            signal.removeEventListener("abort", abort);
            poll = undefined;
          }
          if (signal.aborted || finished) break;
          probe = false;
          retry = 0;
          const events = data.events.filter((e) => e.id > last);
          const before = model.state,
            previous = before.channels.map((c) => c.stream_id);
          const next = model.apply(events, account.userId);
          if (next.channels !== before.channels) {
            const subscribed = new Set(next.channels.map((c) => c.stream_id));
            cache.purgeStreams(previous.filter((id) => !subscribed.has(id)));
            cache.allowStreams([...subscribed]);
          }
          if (next.mutedUsers !== before.mutedUsers)
            cache.setMutedUsers(next.mutedUsers);
          cache.events(events.filter((e) => e.type !== "heartbeat"));
          if (events.length) last = events.at(-1)!.id;
          // Publish only real changes: every new state re-renders the whole app.
          if (next.status !== "Live" || next.error) status("Live");
          else if (next !== before) setState(next);
        } catch (e) {
          if (signal.aborted || finished) break;
          if (e instanceof ApiError && e.status === 401) {
            lock(e.message);
            break;
          }
          if (e instanceof DOMException && e.name === "AbortError" && probe)
            continue;
          if (e instanceof ApiError && e.code === "BAD_EVENT_QUEUE_ID")
            queue = "";
          probe = true;
          status(
            "Reconnecting",
            e instanceof Error ? e.message : "Connection failed",
          );
          try {
            await pause(
              Math.max(
                e instanceof ApiError ? e.retryAfterMs : 0,
                Math.min(30000, 1000 * 2 ** Math.min(retry++, 5)),
              ),
              signal,
            );
          } catch {
            break;
          }
        }
      }
    }
    void run();
    return () => {
      finished = true;
      lifetime.abort();
      poll?.abort();
      window.removeEventListener("zoomerlip-auth-failed", authFailed);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      if (queue)
        void request(
          account,
          "/events",
          { queue_id: queue },
          "DELETE",
          undefined,
          5000,
        ).catch(() => {});
    };
  }, [
    account.id,
    account.apiKey,
    account.url,
    account.email,
    account.name,
    account.userId,
  ]);
  return state;
}
