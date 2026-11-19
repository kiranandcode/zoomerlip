import { ApiError, request } from "../api";
import type { Account } from "../types";
import type { LiveStore, Presence } from "./store";

/** One in-flight request, at most once per minute. Hidden pages do no polling. */
export function startPresence(
  account: Account,
  store: LiveStore,
  active: () => boolean,
  signal: AbortSignal,
) {
  let lastInput = 0,
    newInput = false,
    lastRequest = -Infinity,
    busy = false,
    lastUpdate = -1,
    generation = store.generation;
  const input = () => {
    if (active()) {
      lastInput = Date.now();
      newInput = true;
    }
  };
  const tick = async () => {
    if (
      signal.aborted ||
      !store.state.ready ||
      document.visibilityState !== "visible" ||
      busy ||
      Date.now() - lastRequest < 60000
    )
      return;
    if (generation !== store.generation) {
      generation = store.generation;
      lastUpdate = -1;
    }
    const epoch = generation;
    const featureLevel = store.state.featureLevel;
    if (featureLevel < 80) return;
    busy = true;
    lastRequest = Date.now();
    const hadInput = newInput;
    newInput = false;
    try {
      const result = await request<{
        presences?: Record<string, Presence>;
        presence_last_update_id?: number;
      }>(
        account,
        "/users/me/presence",
        {
          status:
            active() && document.hasFocus() && Date.now() - lastInput < 60000
              ? "active"
              : "idle",
          new_user_input: hadInput,
          ...(featureLevel >= 263
            ? { last_update_id: lastUpdate }
            : { slim_presence: true }),
        },
        "POST",
        signal,
      );
      if (signal.aborted || epoch !== store.generation) return;
      store.mergePresence(result.presences);
      lastUpdate = result.presence_last_update_id ?? -1;
      store.update({ error: "" });
    } catch (error) {
      if (!signal.aborted && epoch === store.generation) {
        if (error instanceof ApiError && error.status === 429)
          lastRequest += error.retryAfterMs;
        store.update({
          error:
            "Presence unavailable. It will retry while this app is visible.",
        });
      }
    } finally {
      busy = false;
    }
  };
  window.addEventListener("pointerdown", input);
  window.addEventListener("keydown", input);
  document.addEventListener("visibilitychange", tick);
  const unsubscribe = store.subscribe(tick);
  const timer = setInterval(tick, 10000);
  void tick();
  return () => {
    clearInterval(timer);
    unsubscribe();
    window.removeEventListener("pointerdown", input);
    window.removeEventListener("keydown", input);
    document.removeEventListener("visibilitychange", tick);
  };
}
