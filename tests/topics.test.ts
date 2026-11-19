import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readThreadMutes, setThreadMute } from "../src/topicPreferences";
import { topicKey, SessionModel, serverMutesTopic } from "../src/sessionModel";
let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM("", { url: "https://client.test" });
  vi.stubGlobal("localStorage", dom.window.localStorage);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  dom.window.close();
});
it("expires timed mutes while retaining indefinite and other-account mutes", () => {
  setThreadMute("a", 1, "Thread", 3600000);
  setThreadMute("a", 1, "Other", null);
  setThreadMute("b", 1, "Thread", null);
  expect(Object.keys(readThreadMutes("a"))).toHaveLength(2);
  vi.advanceTimersByTime(3600001);
  expect(readThreadMutes("a")[topicKey(1, "thread")]).toBeUndefined();
  expect(readThreadMutes("a")[topicKey(1, "other")]).toEqual({ until: null });
  expect(readThreadMutes("b")[topicKey(1, "thread")]).toEqual({ until: null });
  setThreadMute("a", 1, "other", "off");
  expect(readThreadMutes("a")).toEqual({});
});
it("ignores corrupt preference records without suppressing other mutes", () => {
  localStorage.setItem("zoomerlip.thread.v1.a.%zz", '{"until":null}');
  setThreadMute("a", 2, "topic", null);
  expect(Object.keys(readThreadMutes("a"))).toEqual([topicKey(2, "topic")]);
});
it("honours unmuted topics inside a muted channel", () => {
  const m = new SessionModel();
  m.register(
    {
      queue_id: "q",
      last_event_id: 0,
      subscriptions: [
        { stream_id: 1, name: "General", description: "", is_muted: true },
      ],
      user_topics: [
        { stream_id: 1, topic_name: "Followed", visibility_policy: 3 },
      ],
      unread_msgs: {
        streams: [
          { stream_id: 1, topic: "Followed", unread_message_ids: [1] },
          { stream_id: 1, topic: "Quiet", unread_message_ids: [2] },
        ],
      },
    },
    "Test",
  );
  expect(m.state.unread).toBe(1);
  expect(serverMutesTopic(m.state, 1, "Followed")).toBe(false);
  expect(serverMutesTopic(m.state, 1, "Quiet")).toBe(true);
  m.apply(
    [
      {
        id: 1,
        type: "user_topic",
        stream_id: 1,
        topic_name: "Followed",
        visibility_policy: 1,
      },
    ],
    9,
  );
  expect(m.state.unread).toBe(0);
});
