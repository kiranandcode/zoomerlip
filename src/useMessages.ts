import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getCache } from "./cache";
import type { Account, View } from "./types";
export function useMessages(account: Account, view: View) {
  const cache = getCache(account);
  const key = JSON.stringify(view);
  const subscribe = useCallback(
    (listener: () => void) => cache.subscribe(view, listener),
    [cache, key],
  );
  const snapshot = useCallback(() => cache.snapshot(view), [cache, key]);
  const state = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    void cache.load(view);
  }, [cache, key]);
  return { ...state, cache };
}
