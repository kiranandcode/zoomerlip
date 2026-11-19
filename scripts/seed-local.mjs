import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const url = "http://localhost:8080";
const password = "Zoomerlip-local-only-2026!";
const email = "morgan@zoomerlip.test";
const compose = [
  "compose",
  "-p",
  "zoomerlip-local",
  "-f",
  "local/compose.yaml",
];
// Fixed loopback target. Never accepts a production URL.
async function api(path, params = {}, key = "", method = "POST", user = email) {
  const response = await fetch(`${url}/api/v1${path}`, {
    method,
    headers: key
      ? {
          Authorization: `Basic ${Buffer.from(`${user}:${key}`).toString("base64")}`,
        }
      : {},
    ...(method !== "GET"
      ? {
          body: new URLSearchParams(
            Object.entries(params).map(([k, v]) => [
              k,
              typeof v === "object" ? JSON.stringify(v) : String(v),
            ]),
          ),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok || data.result === "error")
    throw new Error(data.msg || String(response.status));
  return data;
}
let auth;
try {
  auth = await api("/fetch_api_key", { username: email, password });
} catch {
  execFileSync(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "-u",
      "zulip",
      "zulip",
      "/home/zulip/deployments/current/manage.py",
      "create_realm",
      "The Common Room",
      email,
      "Morgan Chen",
      "--password",
      password,
    ],
    { stdio: "inherit" },
  );
  auth = await api("/fetch_api_key", { username: email, password });
}
const key = auth.api_key;
const people = [
  ["alex@zoomerlip.test", "Alex Rivera"],
  ["sam@zoomerlip.test", "Sam Park"],
  ["jules@zoomerlip.test", "Jules Brooks"],
];
const existing = (await api("/users", {}, key, "GET")).members;
for (const [email, fullName] of people) {
  if (existing.some((u) => u.full_name === fullName)) continue;
  execFileSync(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "-u",
      "zulip",
      "zulip",
      "/home/zulip/deployments/current/manage.py",
      "create_user",
      "-r",
      "",
      email,
      fullName,
      "--password",
      password,
    ],
    { stdio: "inherit" },
  );
}
const users = (await api("/users", {}, key, "GET")).members;
await api(
  "/users/me/subscriptions",
  {
    subscriptions: [
      { name: "general", description: "The common room. Come hang out." },
      { name: "introductions", description: "New here? Say hello." },
      { name: "creative-corner", description: "Make something worth sharing." },
      { name: "dev-chat", description: "Small fixes. Big ideas." },
      { name: "off-topic", description: "For everything else." },
    ],
    principals: users.filter((u) => !u.is_bot).map((u) => u.user_id),
  },
  key,
);
const alex = await api("/fetch_api_key", { username: people[0][0], password });
const messages = [
  [
    "weekend plans",
    "Anyone making something fun this weekend? 👀",
    alex.api_key,
    people[0][0],
  ],
  [
    "weekend plans",
    "Finally getting around to that tiny game idea. Famous last words.",
    key,
    email,
  ],
  [
    "weekend plans",
    "The scope is **one room**. Holding myself to it this time.",
    key,
    email,
  ],
  [
    "show & tell",
    "A little corner for things we’re proud of. Finished or not — share it here. 🌱",
    key,
    email,
  ],
  [
    "show & tell",
    "Love this. Rough drafts count too.",
    alex.api_key,
    people[0][0],
  ],
  [
    "welcome aboard",
    "Welcome to the common room!\n\nPick a channel, find a thread, make yourself at home. ✨",
    key,
    email,
  ],
];
for (const [topic, content, authKey, user] of messages)
  await api(
    "/messages",
    { type: "stream", to: "general", topic, content },
    authKey,
    "POST",
    user,
  );
await api(
  "/messages",
  {
    type: "private",
    to: [(await api("/users/me", {}, key, "GET")).user_id],
    content: "Hey Morgan! Good to see you here. 👋",
  },
  alex.api_key,
  "POST",
  people[0][0],
);
await mkdir("local", { recursive: true });
await writeFile(
  "local/test-account.json",
  JSON.stringify(
    {
      url,
      email,
      password,
      apiKey: key,
      alex: { email: people[0][0], apiKey: alex.api_key },
      users,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  "Local accounts ready. Login: morgan@zoomerlip.test / Zoomerlip-local-only-2026!",
);
