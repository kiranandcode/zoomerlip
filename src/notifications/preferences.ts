export type NotificationPreferences = {
  enabled: boolean;
  dms: boolean;
  mentions: boolean;
  privatePreview: boolean;
  sound: boolean;
};
export const defaults: NotificationPreferences = {
  enabled: false,
  dms: true,
  mentions: true,
  privatePreview: true,
  sound: false,
};
const prefix = "zoomerlip.notifications.v1.";
export const preferencesKey = (id: string) => prefix + encodeURIComponent(id);
export function readPreferences(id: string): NotificationPreferences {
  try {
    const raw = localStorage.getItem(preferencesKey(id));
    if (!raw || raw.length > 1024) return { ...defaults };
    const value = JSON.parse(raw),
      result = { ...defaults };
    for (const k of Object.keys(defaults) as (keyof NotificationPreferences)[])
      if (typeof value?.[k] === "boolean") result[k] = value[k];
    return result;
  } catch {
    return { ...defaults };
  }
}
export function savePreferences(
  id: string,
  preferences: NotificationPreferences,
) {
  localStorage.setItem(preferencesKey(id), JSON.stringify(preferences));
  window.dispatchEvent(new Event("zoomerlip-notification-preferences"));
}
export function clearNotificationHistory(id: string) {
  try {
    localStorage.removeItem(ledgerKey(id));
    localStorage.removeItem(ledgerKey(id) + ".focus");
  } catch {
    /* Delivery remains stopped. */
  }
}
export function clearNotificationPreferences(id: string) {
  try {
    localStorage.removeItem(preferencesKey(id));
    localStorage.removeItem(ledgerKey(id));
    localStorage.removeItem(ledgerKey(id) + ".focus");
  } catch {
    /* Account revocation still stops delivery. */
  }
}
export const ledgerKey = (id: string) =>
  `zoomerlip.notification-ledger.v1.${encodeURIComponent(id)}`;
