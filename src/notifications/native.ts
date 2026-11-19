import type { Account } from "../types";
declare global {
  interface Window {
    ZoomerlipNotifications?: {
      postMessage: (value: string) => void;
      onmessage?: (event: { data: string }) => void;
    };
  }
}
export function nativeNotifications() {
  return location.origin === "https://appassets.androidplatform.net"
    ? window.ZoomerlipNotifications
    : undefined;
}
export function nativeMessage(value: Record<string, unknown>) {
  nativeNotifications()?.postMessage(JSON.stringify(value));
}
export function synchronizeNativeAccounts(accounts: Account[]) {
  nativeMessage({ op: "accounts", accounts: accounts.map((a) => a.id) });
}
