import { useState } from "react";
import type { Account } from "../types";
import { messagingCapabilities } from "./capabilities";
import { widgetCommand, WIDGET_FEATURE_LEVEL } from "./widgets";
export function WidgetComposer({
  account,
  onCompose,
  onClose,
}: {
  account: Account;
  onCompose: (text: string) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"poll" | "todo">("poll"),
    [title, setTitle] = useState(""),
    [lines, setLines] = useState(""),
    [error, setError] = useState("");
  return (
    <section
      className="messaging-panel"
      aria-label="Create interactive message"
    >
      <header>
        <strong>Poll or to-do list</strong>
        <button onClick={onClose}>Close</button>
      </header>
      {messagingCapabilities(account.id).featureLevel < WIDGET_FEATURE_LEVEL ? (
        <p>
          Interactive creation requires server feature level{" "}
          {WIDGET_FEATURE_LEVEL}. Compose a plain-text question or checklist
          instead.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              onCompose(widgetCommand(kind, title, lines));
              onClose();
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Invalid interactive message.",
              );
            }
          }}
        >
          <label>
            Type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "poll" | "todo")}
            >
              <option value="poll">Poll</option>
              <option value="todo">To-do list</option>
            </select>
          </label>
          <label>
            Question or title
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={1000}
            />
          </label>
          <label>
            Options or tasks (one per line)
            <textarea
              required
              value={lines}
              onChange={(e) => setLines(e.target.value)}
              rows={3}
              maxLength={10000}
            />
          </label>
          <p>
            Prepare a draft, then use Send. Your current composition is saved
            separately.
          </p>
          <button>Prepare interactive draft</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
