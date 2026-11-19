/** Remote images require HTTPS. Plain HTTP is only for the selected local org. */
export function imageURL(
  value: string | null | undefined,
  org: string,
): string {
  if (!value) return "";
  try {
    const url = new URL(value, org);
    if (url.username || url.password) return "";
    if (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        url.origin === org &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      return url.href;
  } catch {
    /* Invalid URLs use the text fallback. */
  }
  return "";
}
