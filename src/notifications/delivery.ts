import type { Account, Message, ZulipEvent } from "../types";
import type { Session } from "../sessionModel";
import { currentThreadMutes } from "../topicPreferences";
import { liveStore } from "../live/store";
import { ledgerKey, readPreferences } from "./preferences";
import { notificationRule } from "./policy";
import { nativeMessage, nativeNotifications } from "./native";

/** Shared lock + bounded persisted IDs: no duplicate delivery when two tabs race. Fail closed without locks/storage. */
export async function claimNotification(
  accountId: string,
  messageId: number,
  deliver: () => boolean,
) {
  if (!navigator.locks) return;
  await navigator.locks.request(ledgerKey(accountId), () => {
    let ids: number[];
    try {
      const value = localStorage.getItem(ledgerKey(accountId));
      const parsed = value && value.length < 32768 ? JSON.parse(value) : [];
      ids = Array.isArray(parsed)
        ? parsed.filter(Number.isSafeInteger).slice(-512)
        : [];
      if (ids.includes(messageId)) return;
      // Reserve before a side effect. Storage failure prevents delivery.
      localStorage.setItem(
        ledgerKey(accountId),
        JSON.stringify([...ids, messageId].slice(-512)),
      );
    } catch {
      return;
    }
    deliver();
  });
}
const focusKey = (id: string) => ledgerKey(id) + ".focus";
function focusedElsewhere(id: string) {
  try {
    return Object.values(
      JSON.parse(localStorage.getItem(focusKey(id)) || "{}"),
    ).some((until) => typeof until === "number" && until > Date.now());
  } catch {
    return true;
  }
}
let audio: AudioContext | undefined;
export async function unlockSound() {
  audio ??= new AudioContext();
  await audio.resume();
  playSound();
}
function playSound() {
  if (!audio || audio.state !== "running") return;
  const osc = audio.createOscillator(),
    gain = audio.createGain();
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.06, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.16);
  osc.start();
  osc.stop(audio.currentTime + 0.17);
}
export function notificationText(message: Message, privatePreview: boolean) {
  if (privatePreview)
    return {
      title: "Zoomerlip",
      body: "New message. Open Zoomerlip to read it.",
    };
  // Text only; no DOM parsing, remote images or HTML insertion.
  const body = message.content
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return { title: message.sender_full_name.slice(0, 100), body };
}
export class NotificationDelivery {
  private pending = new Map<number, ReturnType<typeof setTimeout>>();
  private visible = new Map<number, Notification>();
  private read = new Set<number>();
  private stopped = false;
  private born = Date.now();
  private owner = crypto.randomUUID();
  private focusTimer: ReturnType<typeof setInterval>;
  private focus = () => {
    if (!navigator.locks) return;
    void navigator.locks
      .request(ledgerKey(this.account.id), () => {
        try {
          const raw = localStorage.getItem(focusKey(this.account.id));
          const leases = Object.fromEntries(
            Object.entries(raw && raw.length < 8192 ? JSON.parse(raw) : {})
              .filter(
                ([, until]) => typeof until === "number" && until > Date.now(),
              )
              .slice(-32),
          );
          delete leases[this.owner];
          if (
            !this.stopped &&
            this.active() &&
            document.visibilityState === "visible" &&
            document.hasFocus()
          )
            leases[this.owner] = Date.now() + 15000;
          if (Object.keys(leases).length)
            localStorage.setItem(
              focusKey(this.account.id),
              JSON.stringify(leases),
            );
          else localStorage.removeItem(focusKey(this.account.id));
        } catch {
          /* No reliable storage means delivery is disabled. */
        }
      })
      .catch(() => {});
  };
  private preferencesChanged = () => {
    if (!readPreferences(this.account.id).enabled) this.clear();
  };
  constructor(
    private account: Account,
    private session: () => Session,
    private active: () => boolean,
  ) {
    this.focusTimer = setInterval(this.focus, 5000);
    this.focus();
    window.addEventListener("focus", this.focus);
    window.addEventListener("blur", this.focus);
    document.addEventListener("visibilitychange", this.focus);
    window.addEventListener("storage", this.preferencesChanged);
    window.addEventListener(
      "zoomerlip-notification-preferences",
      this.preferencesChanged,
    );
  }
  events(events: ZulipEvent[]) {
    for (const event of events) {
      if (
        [
          "subscription",
          "stream",
          "realm_user",
          "muted_users",
          "user_topic",
        ].includes(event.type)
      )
        this.clear();
      if (
        event.type === "update_message_flags" &&
        event.flag === "read" &&
        event.op === "add"
      ) {
        if (event.all) this.clear();
        for (const id of (event.messages || []) as number[]) {
          this.read.add(id);
          void claimNotification(this.account.id, id, () => false).catch(
            () => {},
          );
          this.remove(id);
        }
        if (this.read.size > 1024)
          this.read = new Set([...this.read].slice(-512));
      }
      if (event.type === "delete_message")
        for (const id of (event.message_ids || [event.message_id]) as number[])
          this.remove(id);
      if (event.type === "message" && event.message) {
        const m = {
          ...event.message,
          flags: (event.flags || event.message.flags || []) as string[],
        };
        if (m.timestamp * 1000 < this.born - 120000) continue;
        if (
          this.pending.has(m.id) ||
          this.read.has(m.id) ||
          m.flags.includes("read")
        )
          continue;
        if (this.pending.size >= 128) continue;
        // Let read events from this or another device arrive before notifying.
        this.pending.set(
          m.id,
          setTimeout(() => {
            this.pending.delete(m.id);
            void this.notify(m).catch(() => {});
          }, 800),
        );
      }
    }
  }
  private remove(id: number) {
    clearTimeout(this.pending.get(id));
    this.pending.delete(id);
    this.visible.get(id)?.close();
    this.visible.delete(id);
    nativeMessage({ op: "cancel", accountId: this.account.id, messageId: id });
  }
  private async notify(message: Message) {
    const store = liveStore(this.account.id),
      epoch = store.generation;
    const eligible = () =>
      !this.stopped &&
      store.state.ready &&
      epoch === store.generation &&
      !this.read.has(message.id);
    if (!eligible()) return;
    const initial = readPreferences(this.account.id);
    const rule = notificationRule(this.account, message, initial, {
      settings: store.state.settings,
      followed: store.state.followed,
      session: this.session(),
      localMutes: currentThreadMutes(this.account.id),
    });
    if (!rule.visual && !rule.sound) return;
    await claimNotification(this.account.id, message.id, () => {
      if (!eligible() || !readPreferences(this.account.id).enabled)
        return false;
      // Visible activity consumes the claim so another tab cannot notify for it.
      if (focusedElsewhere(this.account.id)) return false;
      if (
        this.active() &&
        document.visibilityState === "visible" &&
        document.hasFocus()
      )
        return false;
      const prefs = readPreferences(this.account.id);
      const { title, body } = notificationText(
        message,
        prefs.privatePreview ||
          (message.type === "private" &&
            store.state.settings.pm_content_in_desktop_notifications === false),
      );
      if (nativeNotifications()) {
        if (rule.visual)
          nativeMessage({
            op: "show",
            accountId: this.account.id,
            messageId: message.id,
            title,
            body,
            sound: rule.sound,
          });
      } else {
        if (
          rule.visual &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          try {
            const n = new Notification(title, {
              body,
              tag: `${this.account.id}:${message.id}`,
              silent: true,
            });
            n.onclick = () => {
              n.close();
              window.focus();
              window.dispatchEvent(
                new CustomEvent("zoomerlip-notification-open", {
                  detail: { accountId: this.account.id, messageId: message.id },
                }),
              );
            };
            n.onclose = () => this.visible.delete(message.id);
            if (this.visible.size >= 64)
              this.remove(this.visible.keys().next().value!);
            this.visible.set(message.id, n);
          } catch {
            /* Unsupported browser notification constructor. Settings explains availability. */
          }
        }
        if (rule.sound) playSound();
      }
      return true;
    });
  }
  clear() {
    for (const id of this.pending.keys()) clearTimeout(this.pending.get(id));
    this.pending.clear();
    for (const n of this.visible.values()) n.close();
    this.visible.clear();
    nativeMessage({ op: "clear", accountId: this.account.id });
  }
  dispose() {
    this.stopped = true;
    clearInterval(this.focusTimer);
    this.focus();
    window.removeEventListener("focus", this.focus);
    window.removeEventListener("blur", this.focus);
    document.removeEventListener("visibilitychange", this.focus);
    window.removeEventListener("storage", this.preferencesChanged);
    window.removeEventListener(
      "zoomerlip-notification-preferences",
      this.preferencesChanged,
    );
    this.clear();
    this.read.clear();
  }
}
