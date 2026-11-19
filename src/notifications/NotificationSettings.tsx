import { useEffect, useState } from "react";
import type { Account } from "../types";
import { request } from "../api";
import { liveStore, useLive } from "../live/store";
import { defaults, readPreferences, savePreferences } from "./preferences";
import { nativeMessage, nativeNotifications } from "./native";
import { unlockSound } from "./delivery";
import type { NotificationChannel } from "./policy";
const settings = [
  ["enable_desktop_notifications", "DM and mention notifications", 80],
  ["enable_sounds", "DM and mention sounds", 80],
  [
    "enable_stream_desktop_notifications",
    "Notify for all channel messages by default",
    80,
  ],
  ["enable_stream_sounds", "Channel sounds by default", 80],
  ["wildcard_mentions_notify", "Notify for @all and @topic", 80],
  [
    "enable_followed_topic_desktop_notifications",
    "Notify for followed topics",
    189,
  ],
  [
    "enable_followed_topic_audible_notifications",
    "Sounds for followed topics",
    189,
  ],
  [
    "enable_followed_topic_wildcard_mentions_notify",
    "Wildcard mentions in followed topics",
    189,
  ],
  ["send_read_receipts", "Share read receipts", 105],
  ["send_private_typing_notifications", "Share typing in DMs", 105],
  ["send_stream_typing_notifications", "Share typing in channels", 105],
] as const;
export function NotificationSettings({ account }: { account: Account }) {
  const live = useLive(account),
    [prefs, setPrefs] = useState(() => readPreferences(account.id)),
    [result, setResult] = useState(""),
    [busy, setBusy] = useState(false),
    [channelId, setChannelId] = useState(0);
  const native = nativeNotifications();
  const [permission, setPermission] = useState(
    native
      ? "Check Android notification settings"
      : typeof Notification === "undefined"
        ? "unavailable"
        : Notification.permission,
  );
  useEffect(() => {
    const sync = () => setPrefs(readPreferences(account.id));
    const permissionChanged = (e: Event) =>
      setPermission((e as CustomEvent).detail);
    window.addEventListener(
      "zoomerlip-notification-permission",
      permissionChanged,
    );
    window.addEventListener("storage", sync);
    window.addEventListener("zoomerlip-notification-preferences", sync);
    return () => {
      window.removeEventListener(
        "zoomerlip-notification-permission",
        permissionChanged,
      );
      window.removeEventListener("storage", sync);
      window.removeEventListener("zoomerlip-notification-preferences", sync);
    };
  }, [account.id]);
  function local(key: keyof typeof defaults, value: boolean) {
    try {
      const next = { ...readPreferences(account.id), [key]: value };
      savePreferences(account.id, next);
      setPrefs(next);
      setResult("");
    } catch {
      setResult("Could not save notification preferences in this browser.");
    }
  }
  async function enable() {
    try {
      if (!navigator.locks) {
        setResult(
          "Notifications require browser Web Locks support to prevent duplicates across tabs.",
        );
        return;
      }
      if (native) {
        nativeMessage({ op: "permission" });
        local("enabled", true);
        setPermission(
          "Permission requested. Android settings controls delivery.",
        );
      } else if (typeof Notification !== "undefined") {
        const p = await Notification.requestPermission();
        setPermission(p);
        if (p === "granted") local("enabled", true);
        else
          setResult(
            "Allow notifications in your browser’s site settings to enable alerts.",
          );
      } else
        setResult(
          "This browser does not support notifications. Use a supported desktop browser or the Android app.",
        );
    } catch {
      setResult("Notification permission could not be requested.");
    }
  }
  async function server(key: string, value: boolean, streamId?: number) {
    setBusy(true);
    setResult("");
    const store = liveStore(account.id),
      generation = store.generation;
    try {
      const response = await request<{
        ignored_parameters_unsupported?: string[];
      }>(
        account,
        streamId ? "/users/me/subscriptions/properties" : "/settings",
        streamId
          ? {
              subscription_data: [
                { stream_id: streamId, property: key, value },
              ],
            }
          : { [key]: value },
        streamId ? "POST" : "PATCH",
      );
      if (response.ignored_parameters_unsupported?.length)
        throw new Error("This server does not support that setting.");
      if (generation !== store.generation) return;
      if (streamId)
        store.update({
          channels: store.state.channels.map((c) =>
            c.stream_id === streamId ? { ...c, [key]: value } : c,
          ),
        });
      else
        store.update({ settings: { ...store.state.settings, [key]: value } });
      setResult("Preference saved.");
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Could not save preference.");
    } finally {
      setBusy(false);
    }
  }
  const channel = live.channels.find((c) => c.stream_id === channelId) as
    NotificationChannel | undefined;
  return (
    <details className="live-settings">
      <summary>Notifications and privacy</summary>
      <p>
        Alerts work while Zoomerlip is running. Closed-app Android push is not
        configured.
      </p>
      <button onClick={() => void enable()}>
        Enable notifications on this device
      </button>
      <p role="status">Permission: {permission}</p>
      {native && (
        <button onClick={() => nativeMessage({ op: "settings" })}>
          Android notification settings
        </button>
      )}
      {Object.entries({
        enabled: "Notifications on this device",
        dms: "Allow DM alerts on this device",
        mentions: "Allow mention alerts on this device",
        privatePreview: "Private previews: hide sender and content",
        sound: "Allow sounds on this device",
      }).map(([key, label]) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={prefs[key as keyof typeof prefs]}
            disabled={key === "enabled" && !prefs.enabled}
            onChange={(e) => local(key as keyof typeof prefs, e.target.checked)}
          />
          {label}
        </label>
      ))}
      <button
        onClick={() =>
          void unlockSound()
            .then(() => local("sound", true))
            .catch(() => setResult("Sound is unavailable in this browser."))
        }
      >
        Enable and test sound
      </button>
      <h3>Organization preferences</h3>
      <p>
        These settings sync with Zulip. Device filters can further silence
        alerts.
      </p>
      {!live.ready ? (
        <p>Loading preferences…</p>
      ) : (
        settings.map(([key, label, level]) => (
          <label key={key}>
            <input
              type="checkbox"
              disabled={busy || live.featureLevel < level}
              checked={live.settings[key] === true}
              onChange={(e) => void server(key, e.target.checked)}
            />
            {label}
            {live.featureLevel < level && " (unsupported server)"}
          </label>
        ))
      )}
      <label>
        Channel overrides
        <select
          value={channelId}
          onChange={(e) => setChannelId(Number(e.target.value))}
        >
          <option value={0}>Choose a channel</option>
          {live.channels.map((c) => (
            <option key={c.stream_id} value={c.stream_id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {channel &&
        (
          [
            ["desktop_notifications", "All message notifications"],
            ["audible_notifications", "All message sounds"],
            ["wildcard_mentions_notify", "Wildcard mentions"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              disabled={busy}
              checked={
                channel[key] ??
                live.settings[
                  key === "desktop_notifications"
                    ? "enable_stream_desktop_notifications"
                    : key === "audible_notifications"
                      ? "enable_stream_sounds"
                      : key
                ] === true
              }
              onChange={(e) => void server(key, e.target.checked, channelId)}
            />
            {label}
          </label>
        ))}
      <small>
        Muted people and local timed topic mutes silence all alerts. Server
        topic/channel mutes silence ordinary and wildcard alerts. Personal
        mentions still apply. Followed or explicitly unmuted topics override
        channel mutes. Read and own messages never alert.
      </small>
      {result && <p role="status">{result}</p>}
    </details>
  );
}
