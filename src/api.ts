import type { Account, View } from "./types";
import { boundedJSON, ResponseTooLarge } from "./responseBody";
export { readAccounts } from "./accountStorage";
export class ApiError extends Error {
  constructor(
    message: string,
    public code = "",
    public status = 0,
    public retryAfterMs = 0,
  ) {
    super(message);
  }
}
export function normalizeOrg(input: string): string {
  const url = new URL(input.includes("://") ? input : `https://${input}`);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error("Enter the organization’s base URL, without a path.");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("Use HTTPS (HTTP is allowed only for local testing).");
  return url.origin;
}
export function basicAuth(email: string, key: string) {
  return `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${email}:${key}`)))}`;
}
const featureLevels = new Map<string, number>();
const cooldowns = new Map<string, number>();
/** A server may ask for a long cooldown, but not one that disables the client. */
export const MAX_RETRY_AFTER = 10 * 60_000;
// setTimeout treats longer delays as zero, which would retry in a tight loop.
const MAX_TIMEOUT = 2147483647;
export const getFeatureLevel = (org: string) => featureLevels.get(org) ?? 177;
export function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      },
      Math.min(MAX_TIMEOUT, Math.max(0, ms)),
    );
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export async function request<T>(
  account: Pick<Account, "url" | "email" | "apiKey">,
  path: string,
  params: Record<string, unknown> | FormData = {},
  method = "GET",
  signal?: AbortSignal,
  timeoutMs = 30000,
): Promise<T> {
  const body = new URLSearchParams();
  const multipart = params instanceof FormData;
  if (multipart && method === "GET")
    throw new Error("Files require a POST request.");
  for (const [key, value] of Object.entries(multipart ? {} : params))
    if (value !== undefined)
      body.set(
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value),
      );
  const query = body.toString();
  for (let attempt = 0; ; attempt++) {
    const wait = (cooldowns.get(account.url) || 0) - Date.now();
    if (wait > 0) await pause(wait, signal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const control = new AbortController();
    const abort = () => control.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () =>
        control.abort(new DOMException("Request timed out", "TimeoutError")),
      timeoutMs,
    );
    let response: Response;
    let data: any;
    try {
      response = await fetch(
        `${account.url}/api/v1${path}${method === "GET" && query ? `?${query}` : ""}`,
        {
          method,
          signal: control.signal,
          credentials: "omit",
          redirect: "error",
          headers: account.apiKey
            ? { Authorization: basicAuth(account.email, account.apiKey) }
            : {},
          ...(method !== "GET"
            ? { body: multipart ? (params as FormData) : body }
            : {}),
        },
      );
      if (
        response.status === 401 &&
        account.apiKey &&
        typeof window !== "undefined"
      )
        window.dispatchEvent(
          new CustomEvent("zoomerlip-auth-failed", {
            detail: {
              url: account.url,
              email: account.email,
              apiKey: account.apiKey,
            },
          }),
        );
      data = await boundedJSON(response).catch((error) => {
        if (error instanceof ResponseTooLarge) {
          control.abort();
          throw new ApiError(
            error.message,
            "RESPONSE_TOO_LARGE",
            response.status,
          );
        }
        if (control.signal.aborted) throw control.signal.reason;
        throw new ApiError(
          `Server returned ${response.status}; check the organization URL.`,
          "",
          response.status,
        );
      });
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new ApiError(
          "Invalid server response.",
          "INVALID_RESPONSE",
          response.status,
        );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
    if (response.status === 429) {
      const header = response.headers.get("Retry-After");
      const seconds =
        header && /^\d+(?:\.\d+)?$/.test(header)
          ? Number(header)
          : Number(data.retry_after);
      const retryAfter = Math.min(
        MAX_RETRY_AFTER,
        Number.isFinite(seconds) && seconds >= 0
          ? seconds * 1000
          : header
            ? Math.max(0, Date.parse(header) - Date.now()) || 1000
            : 1000,
      );
      cooldowns.set(account.url, Date.now() + retryAfter);
      if (method === "GET" && attempt < 1) continue;
      throw new ApiError(
        data.msg || "Rate limited. Retry after the server cooldown.",
        data.code,
        429,
        retryAfter,
      );
    }
    if (!response.ok || data.result === "error")
      throw new ApiError(
        data.msg || `Request failed (${response.status})`,
        data.code,
        response.status,
      );
    if (path === "/register" && typeof data.zulip_feature_level === "number")
      featureLevels.set(account.url, data.zulip_feature_level);
    return data as T;
  }
}
export function narrow(
  view: View,
  featureLevel = 177,
): {
  operator: string;
  operand: string | number | number[];
  negated?: boolean;
}[] {
  if (view.type === "profile")
    return [
      { operator: "sender", operand: view.userId },
      ...(view.posts === "channels"
        ? [
            {
              operator: "is",
              operand: featureLevel >= 177 ? "dm" : "private",
              negated: true,
            },
          ]
        : []),
    ];
  if (view.type === "home")
    return [
      { operator: "is", operand: featureLevel >= 177 ? "dm" : "private" },
    ];
  if (view.type === "dm")
    return [
      {
        operator: featureLevel >= 177 ? "dm" : "pm-with",
        operand: view.userIds,
      },
    ];
  return [
    { operator: "stream", operand: view.channelId },
    ...(view.topic !== undefined
      ? [{ operator: "topic", operand: view.topic }]
      : []),
  ];
}
export async function login(
  url: string,
  email: string,
  secret: string,
  useKey: boolean,
  signal?: AbortSignal,
): Promise<Account> {
  const base = {
    url: normalizeOrg(url),
    email: email.trim(),
    apiKey: useKey ? secret.trim() : "",
  };
  if (!useKey) {
    const result = await request<{ api_key: string; email: string }>(
      base,
      "/fetch_api_key",
      { username: base.email, password: secret },
      "POST",
      signal,
    );
    base.apiKey = result.api_key;
    base.email = result.email;
  }
  const me = await request<{ user_id: number; full_name: string }>(
    base,
    "/users/me",
    {},
    "GET",
    signal,
  );
  return {
    ...base,
    id: `${base.url}|${me.user_id}`,
    name: new URL(base.url).hostname,
    userId: me.user_id,
  };
}

export async function markThreadRead(
  account: Account,
  streamId: number,
  topic: string,
  signal: AbortSignal,
) {
  if (getFeatureLevel(account.url) < 155) {
    await request(
      account,
      "/mark_topic_as_read",
      { stream_id: streamId, topic_name: topic },
      "POST",
      signal,
    );
    return;
  }
  let anchor: string | number = "newest";
  while (!signal.aborted) {
    const page: { found_oldest: boolean; first_processed_id: number | null } =
      await request<{
        found_oldest: boolean;
        first_processed_id: number | null;
      }>(
        account,
        "/messages/flags/narrow",
        {
          anchor,
          include_anchor: anchor === "newest",
          num_before: 1000,
          num_after: 0,
          narrow: [
            ...narrow(
              { type: "channel", channelId: streamId, topic },
              getFeatureLevel(account.url),
            ),
            { operator: "is", operand: "unread" },
          ],
          op: "add",
          flag: "read",
        },
        "POST",
        signal,
      );
    if (page.found_oldest || page.first_processed_id === null) return;
    if (page.first_processed_id === anchor)
      throw new Error(
        "The server did not advance through unread messages. Try again.",
      );
    anchor = page.first_processed_id;
  }
}
