// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import DOMPurify from "dompurify";
import { imageURL } from "../src/imageURL";
import { MAX_MESSAGE_HTML, sanitizeContent } from "../src/content";
import { messageFragment, clearContentCache } from "../src/contentCache";

it("accepts HTTPS images and only the selected loopback HTTP origin", () => {
  expect(imageURL("/avatar.png", "https://org.test")).toBe(
    "https://org.test/avatar.png",
  );
  for (const url of [
    "http://remote.test/a",
    "javascript:alert(1)",
    "data:image/png,x",
    "https://user:password@org.test/a",
    "http://localhost:123/a",
  ])
    expect(imageURL(url, "https://org.test")).toBe("");
  expect(imageURL("/avatar", "http://localhost:123")).toBe(
    "http://localhost:123/avatar",
  );
  expect(imageURL("http://localhost:456/avatar", "http://localhost:123")).toBe(
    "",
  );
});
it("rejects large markup before invoking the HTML parser", () => {
  const spy = vi.spyOn(DOMPurify, "sanitize");
  try {
    const result = sanitizeContent(
      "x".repeat(MAX_MESSAGE_HTML + 1),
      "https://org.test",
    );
    expect(result.textContent).toContain("too large");
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});
it("reuses pristine fragments but never caches live signed URLs or modified nodes", () => {
  const org = "https://cache.test";
  clearContentCache(org);
  const html = '<p>hello</p><img src="/user_uploads/a.png">';
  const spy = vi.spyOn(DOMPurify, "sanitize");
  try {
    const first = messageFragment(html, org);
    first.querySelector("p")!.textContent = "changed";
    first.querySelector("img")!.src = "https://signed.test/private";
    const second = messageFragment(html, org);
    expect(second.querySelector("p")!.textContent).toBe("hello");
    expect(second.querySelector("img")!.getAttribute("src")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    clearContentCache(org);
    messageFragment(html, org);
    expect(spy).toHaveBeenCalledTimes(2);
  } finally {
    spy.mockRestore();
    clearContentCache(org);
  }
});
it("evicts old sanitized fragments after bounded reuse", () => {
  const org = "https://eviction.test";
  messageFragment("<p>first</p>", org);
  for (let i = 0; i < 170; i++) messageFragment(`<p>${i}</p>`, org);
  const spy = vi.spyOn(DOMPurify, "sanitize");
  try {
    messageFragment("<p>first</p>", org);
    expect(spy).toHaveBeenCalledOnce();
  } finally {
    spy.mockRestore();
    clearContentCache(org);
  }
});
