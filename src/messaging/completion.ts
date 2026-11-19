import type { User } from "../types";
export type Completion = { label: string; value: string };
export function completionToken(text: string, cursor: number) {
  const match = /(?:^|\s)([@:])([^\s@:]{0,80})$/.exec(text.slice(0, cursor));
  return match
    ? {
        kind: match[1],
        query: match[2].toLowerCase(),
        start: cursor - match[2].length - 1,
        end: cursor,
      }
    : undefined;
}
export function completions(
  kind: string,
  query: string,
  users: User[],
  emoji: string[],
): Completion[] {
  if (kind === "@")
    return users
      .filter((u) => u.is_active && u.full_name.toLowerCase().includes(query))
      .slice(0, 20)
      .map((u) => ({
        label: u.full_name,
        value: `@**${u.full_name.replace(/[|*\n\r]/g, "")}|${u.user_id}** `,
      }));
  return [
    ...new Set([
      ...emoji,
      "smile",
      "heart",
      "tada",
      "thumbs_up",
      "eyes",
      "rocket",
      "check",
      "wave",
      "thinking",
      "warning",
    ]),
  ]
    .filter(
      (n) => /^[a-zA-Z0-9_+\-]+$/.test(n) && n.toLowerCase().includes(query),
    )
    .slice(0, 20)
    .map((n) => ({ label: `:${n}:`, value: `:${n}: ` }));
}
export function formatSelection(
  text: string,
  start: number,
  end: number,
  before: string,
  after: string,
) {
  const selected = text.slice(start, end) || "text";
  return {
    text: text.slice(0, start) + before + selected + after + text.slice(end),
    start: start + before.length,
    end: start + before.length + selected.length,
  };
}
