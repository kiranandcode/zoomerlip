import { useEffect, useRef, useState } from "react";
import { getCache } from "./cache";
import { ApiError, request } from "./api";
import type { Account, Channel, User, ZulipEvent } from "./types";
export type Session = {
  channels: Channel[];
  users: User[];
  status: string;
  error: string;
  revision: number;
  name: string;
  unread: number;
};
const initial: Session = {
  channels: [],
  users: [],
  status: "Connecting",
  error: "",
  revision: 0,
  name: "",
  unread: 0,
};
export function useSession(account: Account, active: boolean): Session {
  const [state, setState] = useState<Session>(initial);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (active) setState((s) => (s.unread ? { ...s, unread: 0 } : s));
  }, [active]);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    let queue = "",
      last = -1,
      retry = 0;
    const cache = getCache(account);
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(t);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const t = setTimeout(finish, ms);
        signal.addEventListener("abort", finish, { once: true });
      });
    async function run() {
      while (!signal.aborted) {
        try {
          if (!queue) {
            const data = await request<{
              queue_id: string;
              last_event_id: number;
              subscriptions: Channel[];
              realm_users: User[];
              realm_name: string;
            }>(
              account,
              "/register",
              {
                event_types: [
                  "message",
                  "update_message",
                  "delete_message",
                  "reaction",
                  "subscription",
                  "realm_user",
                  "realm",
                  "update_message_flags",
                ],
                fetch_event_types: ["subscription", "realm_user", "realm"],
                apply_markdown: true,
                client_gravatar: false,
              },
              "POST",
              signal,
            );
            queue = data.queue_id;
            last = data.last_event_id;
            cache.invalidate();
            setState((s) => ({
              ...s,
              channels: data.subscriptions || [],
              users: (data.realm_users || []).map((user) => ({
                ...user,
                is_active: true,
              })),
              name: data.realm_name || account.name,
              revision: s.revision + 1,
            }));
          }
          setState((s) =>
            s.status === "Live" && !s.error
              ? s
              : { ...s, status: "Live", error: "" },
          );
          const data = await request<{ events: ZulipEvent[] }>(
            account,
            "/events",
            { queue_id: queue, last_event_id: last, dont_block: false },
            "GET",
            signal,
          );
          retry = 0;
          cache.events(
            data.events.filter(
              (event) => event.id > last && event.type !== "heartbeat",
            ),
          );
          for (const event of data.events) {
            if (event.id <= last) continue;
            if (event.type === "heartbeat") {
              last = event.id;
              continue;
            }
            if (
              event.type === "subscription" ||
              event.type === "realm_user" ||
              event.type === "realm"
            ) {
              const [channels, users] = await Promise.all([
                request<{ subscriptions: Channel[] }>(
                  account,
                  "/users/me/subscriptions",
                  {},
                  "GET",
                  signal,
                ),
                request<{ members: User[] }>(
                  account,
                  "/users",
                  {},
                  "GET",
                  signal,
                ),
              ]);
              setState((s) => ({
                ...s,
                channels: channels.subscriptions,
                users: users.members,
              }));
            }
            if (
              event.type === "message" &&
              !activeRef.current &&
              event.message?.sender_id !== account.userId
            )
              setState((s) => ({ ...s, unread: s.unread + 1 }));
            last = event.id;
          }
        } catch (error) {
          if (signal.aborted) break;
          const message =
            error instanceof Error ? error.message : "Connection failed";
          if (
            error instanceof ApiError &&
            error.code === "BAD_EVENT_QUEUE_ID"
          ) {
            queue = "";
            continue;
          }
          if (error instanceof ApiError && error.status === 401) {
            setState((s) => ({
              ...s,
              status: "Sign in again",
              error: message,
            }));
            break;
          }
          setState((s) => ({ ...s, status: "Reconnecting", error: message }));
          await pause(Math.min(30000, 1000 * 2 ** Math.min(retry++, 5)));
        }
      }
    }
    void run();
    return () => {
      controller.abort();
      if (queue)
        void request(account, "/events", { queue_id: queue }, "DELETE").catch(
          () => {},
        );
    };
  }, [
    account.id,
    account.apiKey,
    account.email,
    account.url,
    account.name,
    account.userId,
  ]);
  return state;
}
