/**
 * An organization's display name comes from its server, so any server can
 * claim another's name. The hostname is the part the user actually chose.
 */
export function orgLabel(name: string, url: string) {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* Saved accounts are validated; keep the raw value otherwise. */
  }
  return !name || name === host ? host : `${name} (${host})`;
}
