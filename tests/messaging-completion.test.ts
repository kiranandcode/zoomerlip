import { expect, it } from "vitest";
import {
  completions,
  completionToken,
  formatSelection,
} from "../src/messaging/completion";
it("finds cursor-local tokens without completing email addresses", () => {
  expect(completionToken("hello @al", 9)).toEqual({
    kind: "@",
    query: "al",
    start: 6,
    end: 9,
  });
  expect(completionToken("a@example", 9)).toBeUndefined();
  expect(completionToken("hello :s", 8)?.kind).toBe(":");
});
it("bounds matches, excludes inactive members and uses stable mention IDs", () => {
  const users = Array.from({ length: 100 }, (_, i) => ({
    user_id: i + 1,
    full_name: `Person ${i}`,
    is_active: i !== 0,
    is_bot: false,
    email: "fixture@test.invalid",
  }));
  const result = completions("@", "person", users, []);
  expect(result).toHaveLength(20);
  expect(result[0].value).toBe("@**Person 1|2** ");
  expect(
    completions(":", "company", [], ["company", "company", "company<script>"]),
  ).toEqual([{ label: ":company:", value: ":company: " }]);
});
it("formats only the selected range and keeps selection inside delimiters", () => {
  expect(formatSelection("hello world", 6, 11, "**", "**")).toEqual({
    text: "hello **world**",
    start: 8,
    end: 13,
  });
});

it("clamps a stale cursor after replacing the entire composition", () => {
  expect(completionToken(":comp", 16)).toEqual({
    kind: ":",
    query: "comp",
    start: 0,
    end: 5,
  });
});
