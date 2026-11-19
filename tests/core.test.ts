// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  basicAuth,
  login,
  narrow,
  normalizeOrg,
  readAccounts,
  request,
} from "../src/api";
import { sanitizeContent } from "../src/content";
import { JSDOM } from "jsdom";
beforeEach(() =>
  vi.stubGlobal(
    "localStorage",
    new JSDOM("", { url: "https://zoomerlip.test" }).window.localStorage,
  ),
);
afterEach(() => vi.unstubAllGlobals());
describe("credential boundaries", () => {
  it("rejects insecure remote URLs and embedded credentials", () => {
    expect(normalizeOrg("example.zulipchat.com/")).toBe(
      "https://example.zulipchat.com",
    );
    expect(normalizeOrg("http://localhost:8080")).toBe("http://localhost:8080");
    for (const url of [
      "http://example.com",
      "https://me:key@example.com",
      "https://example.com/api",
      "javascript:alert(1)",
    ])
      expect(() => normalizeOrg(url)).toThrow();
  });
  it("encodes non-ASCII email correctly", () => {
    expect(atob(basicAuth("é@example.com", "key").slice(6))).toBe(
      "Ã©@example.com:key",
    );
  });
  it("recovers from corrupt saved accounts", () => {
    localStorage.setItem("zoomerlip.accounts.v1", "broken");
    expect(readAccounts()).toEqual([]);
  });
  it("uses URL-encoded parameters and never places credentials in the URL", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ result: "success" })));
    vi.stubGlobal("fetch", fetch);
    await request(
      { url: "https://example.com", email: "me@example.com", apiKey: "secret" },
      "/messages",
      { to: 12, content: "a & b" },
      "POST",
    );
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://example.com/api/v1/messages");
    expect(opts.body.get("content")).toBe("a & b");
    expect(opts.headers.Authorization).toContain("Basic ");
    expect(opts.redirect).toBe("error");
  });
  it("exchanges a password and only returns an API key", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ api_key: "key", email: "me@example.com" }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user_id: 1, full_name: "Me" })),
      );
    vi.stubGlobal("fetch", fetch);
    const result = await login(
      "https://example.com",
      "me@example.com",
      "password",
      false,
    );
    expect(result.apiKey).toBe("key");
    expect(JSON.stringify(result)).not.toContain("password");
    expect(fetch.mock.calls[0][1].body.get("username")).toBe("me@example.com");
  });
});
describe("message safety", () => {
  it("resolves thumbnail images through the original attachment", () => {
    const f = sanitizeContent(
      '<a href="/user_uploads/2/abc/picture.png"><img src="/user_uploads/thumbnail/2/abc/picture.png/840x560.webp"></a>',
      "https://example.com",
    );
    expect(f.querySelector("img")?.dataset.upload).toBe(
      "/user_uploads/2/abc/picture.png",
    );
    expect(f.querySelector("img")?.hasAttribute("src")).toBe(false);
    expect(f.querySelector("a")?.getAttribute("href")).toBe("#attachment");
  });
  it("rejects forged attachment metadata", () => {
    const f = sanitizeContent(
      '<a href="https://evil.test" data-upload="/users/me">x</a><img data-upload="/users/me" src="https://evil.test/x">',
      "https://example.com",
    );
    expect(f.querySelector("[data-upload]")).toBeNull();
  });
  it("renders Zulip sprite emoji without Zulip stylesheets", () => {
    const f = sanitizeContent(
      '<span class="emoji emoji-1f331">:seedling:</span>',
      "https://example.com",
    );
    expect(f.textContent).toBe("🌱");
  });
  it("strips executable markup and dangerous protocols", () => {
    const fragment = sanitizeContent(
      '<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a><svg onload=alert(1)></svg><form><input></form><p style="position:fixed">safe</p>',
      "https://example.com",
    );
    expect(
      fragment.querySelector(
        "script,svg,form,input,[onerror],[onload],[style]",
      ),
    ).toBeNull();
    expect(fragment.querySelector("a")?.getAttribute("href")).toBeNull();
    expect(fragment.textContent).toContain("safe");
  });
  it("marks only same-org uploads for authenticated resolution", () => {
    const f = sanitizeContent(
      '<a href="/user_uploads/1/abc/file.txt">file</a><img src="https://evil.test/user_uploads/1/x"><a href="/help">help</a>',
      "https://example.com",
    );
    expect(f.querySelector("a")?.getAttribute("data-upload")).toBe(
      "/user_uploads/1/abc/file.txt",
    );
    expect(f.querySelector("img")?.hasAttribute("data-upload")).toBe(false);
    expect(f.querySelectorAll("a")[1].href).toBe("https://example.com/help");
    expect(f.querySelectorAll("a")[1].rel).toBe("noopener noreferrer");
  });
  it("builds exact thread and group DM narrows", () => {
    expect(narrow({ type: "channel", channelId: 3, topic: "a & b" })).toEqual([
      { operator: "stream", operand: 3 },
      { operator: "topic", operand: "a & b" },
    ]);
    expect(narrow({ type: "dm", userIds: [2, 3] })).toEqual([
      { operator: "pm-with", operand: [2, 3] },
    ]);
  });
});

it("strips application overlay classes from remote markup while preserving emoji", () => {
  const fragment = sanitizeContent(
    '<div class="modal toast login-screen"><span class="emoji emoji-1f680">rocket</span></div>',
    "https://org.test",
  );
  expect(fragment.querySelector(".modal,.toast,.login-screen")).toBeNull();
  expect(fragment.textContent).toContain("🚀");
});
