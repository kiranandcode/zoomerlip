import { request } from "../api";
import type { Account } from "../types";
export function uploadLink(
  account: Account,
  result: { url?: string; uri?: string; filename?: string },
  fallback: string,
) {
  const raw = result.url ?? result.uri;
  if (typeof raw !== "string")
    throw new Error("Upload response has no file link. Retry the upload.");
  const url = new URL(raw, account.url);
  if (
    url.origin !== account.url ||
    !url.pathname.startsWith("/user_uploads/") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Upload returned an unsafe file link.");
  const name = (result.filename || fallback)
    .replace(/[\[\]\\\r\n]/g, "_")
    .slice(0, 255);
  return `[${name}](${url.pathname.replace(/[()]/g, (c) => encodeURIComponent(c).replace("(", "%28").replace(")", "%29"))})`;
}
export async function uploadAttachment(
  account: Account,
  file: File,
  limitMiB: number,
  signal: AbortSignal,
) {
  if (!limitMiB)
    throw new Error(
      "Uploads are disabled or the organization has not supplied its upload limit.",
    );
  if (!file.size)
    throw new Error("This file is empty. Choose a non-empty file.");
  if (file.size > limitMiB * 1024 * 1024)
    throw new Error(
      `File exceeds this organization's ${limitMiB} MiB limit. Choose a smaller file.`,
    );
  const body = new FormData();
  body.append("filename", file);
  const result = await request<{
    url?: string;
    uri?: string;
    filename?: string;
  }>(account, "/user_uploads", body, "POST", signal, 120000);
  if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
  return uploadLink(account, result, file.name);
}
