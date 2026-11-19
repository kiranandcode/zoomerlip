// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { uploadAttachment, uploadLink } from "../src/messaging/attachments";
import { request } from "../src/api";
vi.mock("../src/api", () => ({ request: vi.fn() }));
const account = {
  id: "fixture",
  url: "https://fixture.invalid",
  email: "fixture@test.invalid",
  apiKey: "fixture",
  name: "Fixture",
  userId: 1,
};
it("rejects foreign upload URLs and escapes filenames and URL parentheses", () => {
  for (const url of [
    "https://evil.invalid/user_uploads/a",
    "//evil.invalid/user_uploads/a",
    "javascript:alert(1)",
    "/api/key",
    "/user_uploads/a?secret=x",
  ])
    expect(() => uploadLink(account, { url }, "a")).toThrow();
  expect(
    uploadLink(
      account,
      { uri: "/user_uploads/a(x)", filename: "[evil]\n" },
      "a",
    ),
  ).toBe("[_evil__](/user_uploads/a%28x%29)");
});
it("checks organization limits before sending a file", async () => {
  vi.mocked(request).mockClear();
  const file = new File(["hello"], "fixture.txt");
  await expect(
    uploadAttachment(account, file, 0, new AbortController().signal),
  ).rejects.toThrow("disabled");
  await expect(
    uploadAttachment(account, file, 0.000001, new AbortController().signal),
  ).rejects.toThrow("exceeds");
  expect(request).not.toHaveBeenCalled();
});
it("uses the selected account, multipart helper, and ignores cancelled completions", async () => {
  const controller = new AbortController();
  vi.mocked(request).mockImplementation(async () => {
    controller.abort();
    return { uri: "/user_uploads/fixture" };
  });
  await expect(
    uploadAttachment(
      account,
      new File(["hello"], "fixture.txt"),
      25,
      controller.signal,
    ),
  ).rejects.toThrow("cancelled");
  expect(request).toHaveBeenCalledWith(
    account,
    "/user_uploads",
    expect.any(FormData),
    "POST",
    controller.signal,
    120000,
  );
});
