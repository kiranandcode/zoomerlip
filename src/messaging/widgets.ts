import type { Message } from "../types";
export type Submessage = {
  id: number;
  sender_id: number;
  msg_type: string;
  content: string;
  message_id: number;
};
export type Widget = {
  kind: "poll" | "todo";
  title: string;
  options: {
    key: string;
    label: string;
    description: string;
    voters: Set<number>;
    completed: boolean;
  }[];
  nextIndex: number;
};
export const MAX_SUBMESSAGES = 2000,
  MAX_WIDGET_BYTES = 256000;
// Conservative support floor: current content-access/submessage protocol at FL354.
export const WIDGET_FEATURE_LEVEL = 354;
export function readWidget(message: Message, me: number): Widget | undefined {
  const entries = message.submessages;
  if (!entries?.length) return;
  if (
    message.widgetOverflow ||
    entries.length > MAX_SUBMESSAGES ||
    entries.reduce((n, s) => n + s.content.length, 0) > MAX_WIDGET_BYTES
  )
    throw new Error(
      "Interactive history exceeds the client limit. Reload or use the organization's web client.",
    );
  const sorted = [...new Map(entries.map((s) => [s.id, s])).values()].sort(
    (a, b) => a.id - b.id,
  );
  const first = sorted[0];
  if (first.sender_id !== message.sender_id || first.msg_type !== "widget")
    throw new Error("Untrusted interactive message.");
  const data = JSON.parse(first.content),
    kind = data.widget_type;
  if (kind !== "poll" && kind !== "todo")
    throw new Error("This interactive message type is unsupported.");
  const extra = data.extra_data || {},
    result: Widget = {
      kind,
      title:
        kind === "poll"
          ? extra.question || "Poll"
          : extra.task_list_title || "Task list",
      options: [],
      nextIndex: 1,
    };
  if (typeof result.title !== "string" || result.title.length > 10000)
    throw new Error("Invalid interactive title.");
  function add(
    key: string,
    label: unknown,
    description: unknown = "",
    completed = false,
  ) {
    if (
      typeof label !== "string" ||
      typeof description !== "string" ||
      label.length > 10000 ||
      description.length > 10000
    )
      throw new Error("Invalid interactive option.");
    if (result.options.some((o) => o.label === label)) return;
    if (result.options.length >= 1000)
      throw new Error("Too many interactive options.");
    result.options.push({
      key,
      label,
      description,
      completed,
      voters: new Set(),
    });
  }
  const initial = kind === "poll" ? extra.options || [] : extra.tasks || [];
  if (!Array.isArray(initial) || initial.length > 1000)
    throw new Error("Invalid interactive options.");
  initial.forEach((item, i) =>
    kind === "poll"
      ? add(`canned,${i}`, item)
      : add(`${i},canned`, item.task, item.desc),
  );
  for (const sub of sorted.slice(1)) {
    if (sub.msg_type !== "widget") continue;
    const e = JSON.parse(sub.content);
    if (!e || typeof e !== "object")
      throw new Error("Invalid interactive update.");
    if (
      kind === "poll" &&
      e.type === "new_option" &&
      Number.isInteger(e.idx) &&
      e.idx >= 0 &&
      e.idx <= 1000
    ) {
      add(`${sub.sender_id},${e.idx}`, e.option);
      if (sub.sender_id === me)
        result.nextIndex = Math.max(result.nextIndex, e.idx + 1);
    } else if (
      kind === "todo" &&
      e.type === "new_task" &&
      Number.isInteger(e.key) &&
      e.key >= 0 &&
      e.key <= 1000 &&
      typeof e.completed === "boolean"
    ) {
      add(`${e.key},${sub.sender_id}`, e.task, e.desc, e.completed);
      if (sub.sender_id === me)
        result.nextIndex = Math.max(result.nextIndex, e.key + 1);
    } else if (
      ((kind === "poll" && e.type === "question") ||
        (kind === "todo" && e.type === "new_task_list_title")) &&
      sub.sender_id === message.sender_id
    ) {
      const title = kind === "poll" ? e.question : e.title;
      if (typeof title === "string" && title.length <= 10000)
        result.title = title;
    } else if (
      kind === "poll" &&
      e.type === "vote" &&
      (e.vote === 1 || e.vote === -1)
    ) {
      const o = result.options.find((o) => o.key === e.key);
      if (o) {
        if (e.vote === 1) o.voters.add(sub.sender_id);
        else o.voters.delete(sub.sender_id);
      }
    } else if (kind === "todo" && e.type === "strike") {
      const o = result.options.find((o) => o.key === e.key);
      if (o) o.completed = !o.completed;
    }
  }
  return result;
}
export function widgetCommand(
  kind: "poll" | "todo",
  title: string,
  lines: string,
) {
  if (!title.trim() || /[\r\n]/.test(title))
    throw new Error("Enter a single-line title.");
  const options = lines
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!options.length || options.length > 100)
    throw new Error("Enter between 1 and 100 options or tasks, one per line.");
  return `/${kind} ${title.trim()}\n${options.map((o) => `- ${o}`).join("\n")}`;
}
