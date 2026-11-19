// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { putAccount, removeAccount, readAccounts } from "../src/accountStorage";
const a = {
    id: "https://org.test|1",
    url: "https://org.test",
    userId: 1,
    email: "one@test.invalid",
    apiKey: "fixture-key",
    name: "Test",
  },
  b = { ...a, id: "https://org.test|2", userId: 2, email: "two@test.invalid" };
beforeEach(() =>
  vi.stubGlobal(
    "localStorage",
    new JSDOM("", { url: "https://client.test" }).window.localStorage,
  ),
);
afterEach(() => vi.unstubAllGlobals());
it("does not restore removed credentials when a stale tab adds another account", () => {
  localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify([a]));
  const stale = readAccounts();
  removeAccount(a.id);
  putAccount(b);
  expect(readAccounts()).toEqual([b]);
  localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify(stale));
  expect(readAccounts()).toEqual([b]);
});
it("drops individual corrupt records without losing valid accounts", () => {
  localStorage.setItem(
    "zoomerlip.accounts.v1",
    JSON.stringify([{ ...a, url: 42 }, a]),
  );
  expect(readAccounts()).toEqual([a]);
});
it("two independent account additions survive without array overwrite", () => {
  putAccount(a);
  putAccount(b);
  expect(readAccounts()).toHaveLength(2);
  removeAccount(a.id);
  expect(readAccounts()).toEqual([b]);
  expect(localStorage.getItem("zoomerlip.accounts.v1") || "").not.toContain(
    "fixture-key",
  );
});

it.each(["%", "%E0%A4", "%C0%AF"])(
  "isolates a malformed URI account key: %s",
  (suffix) => {
    localStorage.setItem("zoomerlip.account.v2." + suffix, "null");
    localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify([a]));
    putAccount(b);
    expect(readAccounts()).toEqual([a, b]);
  },
);
it("still honours removal tombstones when another key has corrupt encoding", () => {
  localStorage.setItem("zoomerlip.account.v2.%", "{}");
  localStorage.setItem("zoomerlip.accounts.v1", JSON.stringify([a, b]));
  removeAccount(a.id);
  expect(readAccounts()).toEqual([b]);
});
it("does not let a noncanonical encoded key override a removal tombstone", () => {
  putAccount(a);
  removeAccount(a.id);
  localStorage.setItem(
    "zoomerlip.account.v2." +
      encodeURIComponent(a.id).replace("https", "%68ttps"),
    JSON.stringify(a),
  );
  expect(readAccounts()).toEqual([]);
});
it("deletes an organization's thread mutes, which name its topics, on removal", async () => {
  const { setThreadMute, readThreadMutes } =
    await import("../src/topicPreferences");
  putAccount(a);
  putAccount(b);
  setThreadMute(a.id, 4, "Private plans", null);
  setThreadMute(b.id, 4, "Kept", null);
  removeAccount(a.id);
  expect(readThreadMutes(a.id)).toEqual({});
  expect(
    Object.keys(localStorage).filter((k) => k.includes("Private")),
  ).toEqual([]);
  expect(Object.keys(readThreadMutes(b.id))).toHaveLength(1);
});
