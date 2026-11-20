import { clearNotificationHistory } from "./notifications/preferences";
import { useEffect, useRef, useState } from "react";
import { listDrafts, clearDrafts } from "./messaging/drafts";
import {
  setMessagingCapabilities,
  setMessagingStreams,
} from "./messaging/capabilities";
import { messagingEvent } from "./messaging/lifecycle";
import { invalidateOrganisation } from "./organisation/lifecycle";
import { getCache } from "./cache";
import { clearUploadCache } from "./uploads";
import { ApiError, pause, request } from "./api";
import { NotificationDelivery } from "./notifications/delivery";
import { startPresence } from "./live/presence";
import { liveStore, releaseLive } from "./live/store";
import { initialSession, SessionModel } from "./sessionModel";
import type { Registration, Session } from "./sessionModel";
import type { Account, ZulipEvent } from "./types";
export type { Session } from "./sessionModel";
export function useSession(account: Account, active: boolean): Session {
  const activeRef = useRef(active);
  activeRef.current = active;
  const [state, setState] = useState<Session>(initialSession);
  useEffect(() => {
    const lifetime = new AbortController(),
      signal = lifetime.signal,
      cache = getCache(account),
      model = new SessionModel(),
      live = liveStore(account.id);
    live.clear();
    const notifications = new NotificationDelivery(
      account,
      () => model.state,
      () => activeRef.current,
    );
    const stopPresence = startPresence(
      account,
      live,
      () => activeRef.current,
      signal,
    );
    const expiry = setInterval(() => live.expire(), 1000);
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
      live.clear();
      notifications.dispose();
      clearNotificationHistory(account.id);
      stopPresence();
      lifetime.abort();
      invalidateOrganisation(account.id);
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
                  "drafts",
                  "realm_emoji",
                  "scheduled_messages",
                  "saved_snippets",
                  "reminders",
                  "submessage",
                  "subscription",
                  "stream",
                  "realm_user",
                  "realm",
                  "realm_user_settings_defaults",
                  "update_message_flags",
                  "muted_users",
                  "user_topic",
                  "typing",
                  "presence",
                  "user_status",
                  "user_settings",
                  "user_group",
                ],
                fetch_event_types: [
                  "subscription",
                  "user_status",
                  "user_settings",
                  "realm_user",
                  "realm",
                  "realm_user_settings_defaults",
                  "muted_users",
                  "user_topic",
                  "recent_private_conversations",
                  "message",
                  "update_message_flags",
                ],
                client_capabilities: {
                  notification_settings_null: true,
                  user_settings_object: true,
                  simplified_presence_events: true,
                },
                apply_markdown: true,
                client_gravatar: false,
              },
              "POST",
              signal,
            );
            if (signal.aborted || finished) break;
            setMessagingCapabilities(
              account.id,
              data as unknown as Record<string, unknown>,
            );
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
            notifications.clear();
            live.register(data as unknown as Record<string, unknown>);
            invalidateOrganisation(account.id);
            cache.unlock();
            const registered = new Set(
              model.state.channels.map((c) => c.stream_id),
            );
            const draftStreams = listDrafts(account.id).flatMap((d) =>
              d.view.type === "channel" && !registered.has(d.view.channelId)
                ? [d.view.channelId]
                : [],
            );
            if (draftStreams.length) clearDrafts(account.id, draftStreams);
            cache.purgeStreams(previous.filter((id) => !registered.has(id)));
            setMessagingStreams(
              account.id,
              model.state.channels.map((c) => c.stream_id),
            );
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
          live.events(events, account);
          if (next.channels !== before.channels)
            live.update({ channels: next.channels });
          notifications.events(events);
          invalidateOrganisation(account.id, events);
          if (next.channels !== before.channels) {
            const subscribed = new Set(next.channels.map((c) => c.stream_id));
            cache.purgeStreams(previous.filter((id) => !subscribed.has(id)));
            setMessagingStreams(account.id, [...subscribed]);
            cache.allowStreams([...subscribed]);
          }
          if (next.mutedUsers !== before.mutedUsers)
            cache.setMutedUsers(next.mutedUsers);
          messagingEvent(account, events);
          cache.events(events.filter((e) => e.type !== "heartbeat"));
          if (events.length) last = events.at(-1)!.id;
          if (
            events.some(
              (e) =>
                (e.type === "realm_user" &&
                  (e.person as { user_id?: number; role?: number })?.user_id ===
                    account.userId &&
                  (e.person as { role?: number }).role !== undefined) ||
                (e.type === "stream" &&
                  e.op === "update" &&
                  e.property === "is_archived" &&
                  e.value === false),
            )
          ) {
            // Derived capability booleans are registration data. Renew after a
            // role change instead of retaining grants from the previous role.
            // Restoration also reloads authoritative subscriptions; metadata
            // access alone must never add a channel to the subscribed sidebar.
            const previousQueue = queue;
            queue = "";
            void request(
              account,
              "/events",
              { queue_id: previousQueue },
              "DELETE",
              signal,
              5000,
            ).catch(() => {});
          }
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
      clearInterval(expiry);
      stopPresence();
      notifications.dispose();
      releaseLive(account.id);
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
