import { useEffect, useRef, useState } from "react";
import { useOrganisationRevision } from "./lifecycle";
// Component-local data only; no cross-account cache. Hide old data synchronously
// when the revision changes, before an effect has a chance to fetch replacements.
export function useResource<T>(
  accountId: string,
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
) {
  const revision = useOrganisationRevision(accountId);
  const [retry, setRetry] = useState(0);
  const token = `${key}:${revision}:${retry}`;
  const [state, setState] = useState<{
    token: string;
    data?: T;
    error?: string;
  }>({ token: "" });
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    const controller = new AbortController();
    void loader
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ token, data });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setState({ token, error: e.message });
      });
    return () => controller.abort();
  }, [accountId, token]);
  return {
    data: state.token === token ? state.data : undefined,
    error: state.token === token ? state.error : "",
    loading: state.token !== token,
    refresh: () => setRetry((n) => n + 1),
  };
}
export function useOperation() {
  const flight = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => () => flight.current?.abort(), []);
  async function run(
    work: (signal: AbortSignal) => Promise<unknown>,
    success?: () => void,
  ) {
    if (flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work(controller.signal);
      if (!controller.signal.aborted) {
        setNotice("Saved.");
        success?.();
      }
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) {
        flight.current = null;
        setBusy(false);
      }
    }
  }
  return { busy, error, notice, run };
}
