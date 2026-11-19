import { request } from "./api";
import type { Account } from "./types";
type Job = {
  controller: AbortController;
  promise: Promise<string>;
  users: number;
};
type Pool = {
  key: string;
  jobs: Map<string, Job>;
  running: number;
  waiters: { grant: () => void; signal: AbortSignal }[];
};
const pools = new Map<string, Pool>();
export function clearUploadCache(id: string) {
  const pool = pools.get(id);
  if (pool) {
    for (const job of pool.jobs.values()) job.controller.abort();
    pools.delete(id);
  }
}
const aborted = () => new DOMException("Aborted", "AbortError");
async function slot(pool: Pool, signal: AbortSignal) {
  if (signal.aborted) throw aborted();
  if (pool.running < 3) {
    pool.running++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter = {
      signal,
      grant: () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
    };
    const abort = () => {
      pool.waiters = pool.waiters.filter((w) => w !== waiter);
      reject(aborted());
    };
    pool.waiters.push(waiter);
    signal.addEventListener("abort", abort, { once: true });
  });
}
function release(pool: Pool) {
  pool.running--;
  while (pool.waiters.length) {
    const next = pool.waiters.shift()!;
    if (next.signal.aborted) continue;
    // Reserve before resolving. A new caller may run before the awakened
    // promise continuation and must not take this same slot.
    pool.running++;
    next.grant();
    break;
  }
}
// Only in-flight resolutions are shared. Zulip requires immediate consumption of
// signed URLs and explicitly forbids caching them, even for a presumed lifetime.
export async function resolveUpload(
  account: Account,
  path: string,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const key = `${account.url}\0${account.email}\0${account.apiKey}`;
  let pool = pools.get(account.id);
  if (!pool || pool.key !== key) {
    clearUploadCache(account.id);
    pool = { key, jobs: new Map(), running: 0, waiters: [] };
    pools.set(account.id, pool);
  }
  let job = pool.jobs.get(path);
  if (job?.controller.signal.aborted) job = undefined;
  if (!job) {
    const controller = new AbortController(),
      p = pool;
    const created: Job = { controller, users: 0, promise: Promise.resolve("") };
    created.promise = (async () => {
      await slot(p, controller.signal);
      try {
        if (controller.signal.aborted) throw aborted();
        const result = await request<{ url: string }>(
          account,
          path,
          {},
          "GET",
          controller.signal,
        );
        if (controller.signal.aborted) throw aborted();
        const url = new URL(result.url, account.url);
        if (
          url.username ||
          url.password ||
          !(
            url.protocol === "https:" ||
            (url.protocol === "http:" &&
              url.origin === account.url &&
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
          )
        )
          throw new Error("Invalid attachment URL");
        return url.href;
      } finally {
        release(p);
      }
    })().finally(() => {
      if (p.jobs.get(path) === created) p.jobs.delete(path);
    });
    job = created;
    pool.jobs.set(path, job);
  }
  const current = job;
  current.users++;
  try {
    return await new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        current.controller.signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(aborted());
      };
      signal.addEventListener("abort", abort, { once: true });
      current.controller.signal.addEventListener("abort", abort, {
        once: true,
      });
      current.promise.then(
        (url) => {
          cleanup();
          if (signal.aborted || current.controller.signal.aborted)
            reject(aborted());
          else resolve(url);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  } finally {
    current.users--;
    if (current.users === 0) current.controller.abort();
  }
}
