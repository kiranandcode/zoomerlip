import { ApiError, request } from "../api";
import type { Account, Channel } from "../types";
import { mutation } from "./channels";

export const MUTE_FEATURE_LEVEL = 139;
export const FOLLOW_FEATURE_LEVEL = 219;
const MAX_ITEMS = 10000;
export type PreferenceKind = "mute" | "unfollow";
export type PreferenceTarget = {
  streamId: number;
  topic?: string;
  label: string;
};
export type PreferencePlan = {
  accountId: string;
  kind: PreferenceKind;
  targets: PreferenceTarget[];
};
export type PreferenceReport = {
  total: number;
  succeeded: number;
  skipped: number;
  failures: { label: string; error: string }[];
  unattempted: number;
  stopped: boolean;
};
function supported(featureLevel: number, kind: PreferenceKind) {
  const floor = kind === "mute" ? MUTE_FEATURE_LEVEL : FOLLOW_FEATURE_LEVEL;
  if (featureLevel < floor)
    throw new Error(
      `This action requires Zulip feature level ${floor} or later.`,
    );
}
function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
async function subscriptions(account: Account, signal: AbortSignal) {
  const data = await request<{ subscriptions: Channel[] }>(
    account,
    "/users/me/subscriptions",
    {},
    "GET",
    signal,
  );
  if (
    !Array.isArray(data.subscriptions) ||
    data.subscriptions.length > MAX_ITEMS ||
    data.subscriptions.some(
      (c) =>
        !validId(c.stream_id) ||
        typeof c.name !== "string" ||
        typeof c.is_muted !== "boolean",
    )
  )
    throw new Error(
      "Could not load complete channel mute settings (limit: 10,000 channels). Refresh before retrying.",
    );
  return data.subscriptions.filter((c) => !c.is_archived);
}
async function followedTopics(account: Account, signal: AbortSignal) {
  // There is no GET user_topics endpoint. Fetch a fresh registration snapshot;
  // never infer 'all' from a truncated or lowercased display store.
  const data = await request<{
    queue_id: string;
    user_topics: {
      stream_id: number;
      topic_name: string;
      visibility_policy: number;
    }[];
  }>(
    account,
    "/register",
    {
      event_types: [],
      fetch_event_types: ["user_topic"],
      client_capabilities: {
        notification_settings_null: true,
        user_settings_object: true,
        simplified_presence_events: true,
      },
    },
    "POST",
    signal,
  );
  try {
    if (
      !Array.isArray(data.user_topics) ||
      data.user_topics.length > MAX_ITEMS ||
      data.user_topics.some(
        (t) =>
          !validId(t.stream_id) ||
          typeof t.topic_name !== "string" ||
          ![0, 1, 2, 3].includes(t.visibility_policy),
      )
    )
      throw new Error(
        "Could not load complete topic preferences (limit: 10,000 topics). Refresh before retrying.",
      );
    return data.user_topics.filter((t) => t.visibility_policy === 3);
  } finally {
    if (typeof data.queue_id === "string" && !signal.aborted)
      await request(
        account,
        "/events",
        { queue_id: data.queue_id },
        "DELETE",
        signal,
        5000,
      ).catch(() => {});
    // On cancellation the unused queue expires server-side; no further request
    // is made with credentials that may have just been removed or revoked.
  }
}
const key = (target: PreferenceTarget) =>
  JSON.stringify([target.streamId, target.topic?.toLowerCase()]);
export async function preparePreferencePlan(
  account: Account,
  featureLevel: number,
  kind: PreferenceKind,
  signal: AbortSignal,
): Promise<PreferencePlan> {
  supported(featureLevel, kind);
  const targets: PreferenceTarget[] =
    kind === "mute"
      ? (await subscriptions(account, signal))
          .filter((c) => !c.is_muted)
          .map((c) => ({ streamId: c.stream_id, label: c.name }))
      : (await followedTopics(account, signal)).map((t) => ({
          streamId: t.stream_id,
          topic: t.topic_name,
          label: `Channel ${t.stream_id} / ${t.topic_name || "(general chat)"}`,
        }));
  return {
    accountId: account.id,
    kind,
    targets: [...new Map(targets.map((t) => [key(t), t])).values()],
  };
}
async function writeMute(
  account: Account,
  streamId: number,
  muted: boolean,
  signal: AbortSignal,
) {
  return mutation(
    account,
    "/users/me/subscriptions/properties",
    {
      subscription_data: [
        { stream_id: streamId, property: "is_muted", value: muted },
      ],
    },
    "POST",
    signal,
  );
}
export async function setChannelMuted(
  account: Account,
  featureLevel: number,
  streamId: number,
  muted: boolean,
  signal: AbortSignal,
) {
  supported(featureLevel, "mute");
  const channel = (await subscriptions(account, signal)).find(
    (c) => c.stream_id === streamId,
  );
  if (!channel)
    throw new Error(
      "You are no longer subscribed to this active channel. Refresh the directory.",
    );
  if (channel.is_muted !== muted)
    await writeMute(account, streamId, muted, signal);
}
export async function applyPreferencePlan(
  account: Account,
  featureLevel: number,
  plan: PreferencePlan,
  signal: AbortSignal,
  progress: (report: PreferenceReport) => void = () => {},
): Promise<PreferenceReport> {
  if (account.id !== plan.accountId)
    throw new Error("This selection belongs to another account.");
  if (plan.targets.length > MAX_ITEMS)
    throw new Error("Too many selected preferences.");
  // Recheck after confirmation. Never add newly joined/followed items to the
  // approved selection, or overwrite topics that have since been muted.
  const fresh = await preparePreferencePlan(
    account,
    featureLevel,
    plan.kind,
    signal,
  );
  const current = new Map(fresh.targets.map((t) => [key(t), t]));
  const targets = [...new Map(plan.targets.map((t) => [key(t), t])).values()];
  const report: PreferenceReport = {
    total: targets.length,
    succeeded: 0,
    skipped: 0,
    failures: [],
    unattempted: targets.length,
    stopped: false,
  };
  for (const target of targets) {
    if (signal.aborted) {
      report.stopped = true;
      break;
    }
    const latest = current.get(key(target));
    if (!latest) {
      report.skipped++;
      report.unattempted--;
      progress({ ...report, failures: [...report.failures] });
      continue;
    }
    try {
      if (plan.kind === "mute")
        await writeMute(account, latest.streamId, true, signal);
      else {
        if (latest.topic === "" && featureLevel < 334)
          throw new ApiError(
            "Empty topics require feature level 334.",
            "",
            400,
          );
        await mutation(
          account,
          "/user_topics",
          {
            stream_id: latest.streamId,
            topic: latest.topic,
            visibility_policy: 0,
          },
          "POST",
          signal,
        );
      }
      report.succeeded++;
    } catch (error) {
      const knownRejection =
        error instanceof ApiError && [400, 403, 404].includes(error.status);
      report.failures.push({
        label: target.label,
        error: knownRejection
          ? error.message
          : `Outcome not confirmed. Refresh before retrying. ${error instanceof Error ? error.message : "Request failed."}`,
      });
      // Stop on cancellation, auth failure, rate limiting or ambiguous transport
      // failures. Successful earlier writes are not rolled back or replayed.
      if (!knownRejection || signal.aborted) report.stopped = true;
    }
    report.unattempted--;
    progress({ ...report, failures: [...report.failures] });
    if (report.stopped) break;
  }
  return report;
}
