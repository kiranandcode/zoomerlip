import { useEffect, useRef, useState } from "react";
import type { Account, Channel } from "../types";
import { invalidateOrganisation } from "./lifecycle";
import { useOperation } from "./useResource";
import {
  applyPreferencePlan,
  FOLLOW_FEATURE_LEVEL,
  MUTE_FEATURE_LEVEL,
  preparePreferencePlan,
  setChannelMuted,
} from "./subscriptionPreferences";
import type {
  PreferenceKind,
  PreferenceReport,
} from "./subscriptionPreferences";

export function ChannelMuteControl({
  account,
  channel,
  featureLevel,
}: {
  account: Account;
  channel: Channel;
  featureLevel: number;
}) {
  const operation = useOperation();
  if (featureLevel < MUTE_FEATURE_LEVEL)
    return (
      <p>
        Channel mute controls require Zulip feature level {MUTE_FEATURE_LEVEL}{" "}
        or later.
      </p>
    );
  if (typeof channel.is_muted !== "boolean")
    return <p>Mute state unavailable. Refresh the directory.</p>;
  return (
    <div className="organisation-form">
      <p>
        {channel.is_muted
          ? "This channel is muted."
          : "This channel is not muted."}{" "}
        Muting keeps you joined. Mentions and topic overrides may still notify
        you.
      </p>
      <button
        disabled={operation.busy}
        onClick={() => {
          const mute = !channel.is_muted;
          void operation.run(
            (signal) =>
              setChannelMuted(
                account,
                featureLevel,
                channel.stream_id,
                mute,
                signal,
              ),
            () => invalidateOrganisation(account.id),
          );
        }}
      >
        {operation.busy
          ? "Saving mute preference…"
          : channel.is_muted
            ? "Unmute channel"
            : "Mute channel"}
      </button>
      {operation.error && <p role="alert">{operation.error}</p>}
    </div>
  );
}

export function BulkChannelPreferences({
  account,
  featureLevel,
  active,
}: {
  account: Account;
  featureLevel: number;
  active: boolean;
}) {
  const flight = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState(""),
    [error, setError] = useState(""),
    [report, setReport] = useState<PreferenceReport | null>(null);
  useEffect(() => {
    const reset = (event: Event) => {
      if (
        (event as CustomEvent<{ accountId: string }>).detail?.accountId ===
        account.id
      )
        flight.current?.abort();
    };
    window.addEventListener("zoomerlip-messaging-reset", reset);
    return () => {
      flight.current?.abort();
      window.removeEventListener("zoomerlip-messaging-reset", reset);
    };
  }, [account.id]);
  useEffect(() => {
    if (!active) flight.current?.abort();
  }, [active]);
  async function run(kind: PreferenceKind) {
    if (flight.current || !active) return;
    const controller = new AbortController();
    flight.current = controller;
    setError("");
    setReport(null);
    setPhase("Loading current preferences…");
    try {
      const plan = await preparePreferencePlan(
        account,
        featureLevel,
        kind,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!plan.targets.length) {
        setError(
          kind === "mute"
            ? "All joined active channels are already muted."
            : "No followed topics.",
        );
        return;
      }
      if (
        !window.confirm(
          kind === "mute"
            ? `Mute ${plan.targets.length} currently unmuted joined channels in ${account.name}? You will remain subscribed. Mentions and topic overrides may still notify you.`
            : `Unfollow ${plan.targets.length} followed topics in ${account.name}? They will use channel defaults. Muted and explicitly unmuted topics stay unchanged. Channel subscriptions stay in place.`,
        )
      )
        return;
      setPhase(
        kind === "mute" ? "Muting joined channels…" : "Unfollowing topics…",
      );
      const result = await applyPreferencePlan(
        account,
        featureLevel,
        plan,
        controller.signal,
        setReport,
      );
      setReport(result);
    } catch (e) {
      setError(
        controller.signal.aborted
          ? "Stopped. Any confirmed changes remain saved. Refresh before retrying."
          : e instanceof Error
            ? e.message
            : "Could not update preferences.",
      );
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        setPhase("");
      }
      invalidateOrganisation(account.id);
    }
  }
  return (
    <details className="organisation-form">
      <summary>Channel and topic preferences</summary>
      <p>
        Joining a channel subscribes you to it. Following applies to individual
        topics. These actions keep your channel subscriptions.
      </p>
      <div className="organisation-toolbar">
        <button
          disabled={!!phase || !active || featureLevel < MUTE_FEATURE_LEVEL}
          onClick={() => void run("mute")}
        >
          Mute all joined channels
        </button>
        <button
          disabled={!!phase || !active || featureLevel < FOLLOW_FEATURE_LEVEL}
          onClick={() => void run("unfollow")}
        >
          Unfollow all followed topics
        </button>
        {phase && (
          <button onClick={() => flight.current?.abort()}>
            Stop preference changes
          </button>
        )}
      </div>
      {featureLevel < MUTE_FEATURE_LEVEL && (
        <p>Channel muting requires feature level {MUTE_FEATURE_LEVEL}.</p>
      )}
      {featureLevel < FOLLOW_FEATURE_LEVEL && (
        <p>Topic following requires feature level {FOLLOW_FEATURE_LEVEL}.</p>
      )}
      <p>
        Unfollowing clears existing follows. Automatic-follow settings can still
        follow future topics.
      </p>
      {phase && <p role="status">{phase}</p>}
      {error && <p role="status">{error}</p>}
      {report && (
        <div aria-label="Preference results">
          <p role="status">
            {report.succeeded} confirmed; {report.skipped} already changed or
            unavailable; {report.failures.length} failed or unconfirmed;{" "}
            {report.unattempted} not attempted.
            {report.stopped ? " Stopped. Refresh before retrying." : ""}
          </p>
          {report.failures.length > 0 && (
            <ul>
              {report.failures.slice(0, 100).map((failure, index) => (
                <li key={index}>
                  {failure.label}: {failure.error}
                </li>
              ))}
            </ul>
          )}
          {report.failures.length > 100 && (
            <p>
              Showing the first 100 failures. Run again to load the remaining
              current preferences.
            </p>
          )}
        </div>
      )}
    </details>
  );
}
