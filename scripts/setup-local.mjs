// Generate ignored secrets for the checked-in official docker-zulip configuration.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const compose = await readFile("local/compose.yaml", "utf8");
if (!compose.includes("127.0.0.1:8080:80"))
  throw new Error("Expected a loopback-only test configuration.");
await mkdir("local/.secrets", { recursive: true });
for (const key of [
  "postgres_password",
  "memcached_password",
  "rabbitmq_password",
  "redis_password",
  "secret_key",
  "email_password",
]) {
  const path = `local/.secrets/${key}`;
  try {
    await readFile(path);
  } catch {
    await writeFile(path, randomBytes(32).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  }
}
console.log(
  "Local secrets ready. Run: docker compose -p zoomerlip-local -f local/compose.yaml up -d",
);
