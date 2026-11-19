import { expect, it } from "vitest";
import { readWidget, widgetCommand } from "../src/messaging/widgets";
import { applyMessageEvent } from "../src/cache";
import type { Message } from "../src/types";
const sub = (id: number, sender_id: number, data: unknown) => ({
  id,
  sender_id,
  msg_type: "widget",
  message_id: 1,
  content: JSON.stringify(data),
});
const message = (data: unknown) =>
  ({ id: 1, sender_id: 2, submessages: [sub(1, 2, data)] }) as Message;
it("uses upstream poll option keys and per-user votes", () => {
  const m = message({
    widget_type: "poll",
    extra_data: { question: "Lunch?", options: ["Soup", "Salad"] },
  });
  m.submessages!.push(
    sub(2, 3, { type: "vote", key: "canned,0", vote: 1 }),
    sub(3, 4, { type: "vote", key: "canned,0", vote: 1 }),
    sub(4, 3, { type: "vote", key: "canned,0", vote: -1 }),
  );
  expect([...readWidget(m, 3)!.options[0].voters]).toEqual([4]);
});
it("deduplicates to-do strikes and rejects forged titles", () => {
  const m = message({
    widget_type: "todo",
    extra_data: {
      task_list_title: "Tasks",
      tasks: [{ task: "One", desc: "Detail" }],
    },
  });
  const strike = sub(2, 3, { type: "strike", key: "0,canned" });
  m.submessages!.push(
    strike,
    strike,
    sub(3, 3, { type: "new_task_list_title", title: "forged" }),
  );
  const w = readWidget(m, 3)!;
  expect(w.title).toBe("Tasks");
  expect(w.options[0].completed).toBe(true);
});
it("rejects untrusted creators and oversized history", () => {
  const m = message({ widget_type: "poll", extra_data: { options: [] } });
  m.submessages![0].sender_id = 9;
  expect(() => readWidget(m, 1)).toThrow("Untrusted");
  m.widgetOverflow = true;
  expect(() => readWidget(m, 1)).toThrow("limit");
});
it("replays live submessages once through the cache", () => {
  const m = message({
    widget_type: "todo",
    extra_data: { tasks: [{ task: "One", desc: "" }] },
  });
  const e = {
    id: 5,
    type: "submessage",
    submessage_id: 2,
    sender_id: 3,
    message_id: 1,
    msg_type: "widget",
    content: JSON.stringify({ type: "strike", key: "0,canned" }),
  };
  const view = { type: "channel" as const, channelId: 4 };
  const first = applyMessageEvent([m], e, view, 3),
    second = applyMessageEvent(first, e, view, 3);
  expect(second[0].submessages).toHaveLength(2);
  expect(readWidget(second[0], 3)!.options[0].completed).toBe(true);
});
it("prepares documented slash commands without sending", () => {
  expect(widgetCommand("poll", "Lunch?", "Soup\nSalad")).toBe(
    "/poll Lunch?\n- Soup\n- Salad",
  );
  expect(() => widgetCommand("todo", "Tasks", "")).toThrow();
});
