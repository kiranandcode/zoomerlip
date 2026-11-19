import type { Account, View } from "./types";
export class ApiError extends Error {
  constructor(
    message: string,
    public code = "",
    public status = 0,
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
export async function request<T>(
  account: Pick<Account, "url" | "email" | "apiKey">,
  path: string,
  params: Record<string, unknown> = {},
  method = "GET",
  signal?: AbortSignal,
): Promise<T> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined)
      body.set(
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value),
      );
  const response = await fetch(
    `${account.url}/api/v1${path}${method === "GET" && body.size ? `?${body}` : ""}`,
    {
      method,
      signal,
      credentials: "omit",
      redirect: "error",
      headers: account.apiKey
        ? { Authorization: basicAuth(account.email, account.apiKey) }
        : {},
      ...(method !== "GET" ? { body } : {}),
    },
  );
  const data = await response.json().catch(() => {
    throw new ApiError(
      `Server returned ${response.status}; check the organization URL.`,
      "",
      response.status,
    );
  });
  if (!response.ok || data.result === "error")
    throw new ApiError(
      data.msg || `Request failed (${response.status})`,
      data.code,
      response.status,
    );
  return data as T;
}
export function narrow(
  view: View,
): { operator: string; operand: string | number | number[] }[] {
  if (view.type === "home") return [{ operator: "is", operand: "private" }];
  if (view.type === "dm")
    return [{ operator: "pm-with", operand: view.userIds }];
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
    );
    base.apiKey = result.api_key;
    base.email = result.email;
  }
  const me = await request<{ user_id: number; full_name: string }>(
    base,
    "/users/me",
  );
  return {
    ...base,
    id: `${base.url}|${me.user_id}`,
    name: new URL(base.url).hostname,
    userId: me.user_id,
  };
}
const storageKey = "zoomerlip.accounts.v1";
export function readAccounts(): Account[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(saved)
      ? saved.filter(
          (a): a is Account =>
            a &&
            typeof a.id === "string" &&
            typeof a.email === "string" &&
            typeof a.apiKey === "string" &&
            typeof a.name === "string" &&
            Number.isInteger(a.userId) &&
            normalizeOrg(a.url) === a.url,
        )
      : [];
  } catch {
    return [];
  }
}
export function saveAccounts(accounts: Account[]) {
  localStorage.setItem(storageKey, JSON.stringify(accounts));
}
