import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { request } from "../api";
import type { Account, User } from "../types";
import { completionToken, completions } from "./completion";
export function useCompletion(
  account: Account,
  users: User[],
  text: string,
  input: RefObject<HTMLTextAreaElement | null>,
  change: (value: string) => void,
) {
  const [cursor, setCursor] = useState(0),
    [index, setIndex] = useState(0),
    [dismissed, setDismissed] = useState(""),
    [emoji, setEmoji] = useState<string[]>([]),
    [error, setError] = useState("");
  const composing = useRef(false),
    id = useId();
  const token = completionToken(text, cursor);
  const signature = `${cursor}:${text}`;
  const options =
    token && dismissed !== signature && !composing.current
      ? completions(token.kind, token.query, users, emoji)
      : [];
  const needsEmoji = token?.kind === ":";
  useEffect(() => {
    if (!needsEmoji) return;
    const control = new AbortController();
    const load = () => {
      void request<{
        emoji: Record<string, { name: string; deactivated: boolean }>;
      }>(account, "/realm/emoji", {}, "GET", control.signal)
        .then((d) => {
          if (!control.signal.aborted) {
            setEmoji(
              Object.values(d.emoji)
                .filter((e) => !e.deactivated && typeof e.name === "string")
                .slice(0, 10000)
                .map((e) => e.name),
            );
            setError("");
          }
        })
        .catch(() => {
          if (!control.signal.aborted)
            setError(
              "Organization emoji could not load. Type a known :emoji_name: or retry by reopening autocomplete.",
            );
        });
    };
    load();
    const update = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (
        d.accountId === account.id &&
        d.events.some((x: { type: string }) => x.type === "realm_emoji")
      )
        load();
    };
    window.addEventListener("zoomerlip-messaging", update);
    return () => {
      control.abort();
      window.removeEventListener("zoomerlip-messaging", update);
    };
  }, [account, needsEmoji]);
  const selected = Math.min(index, Math.max(0, options.length - 1));
  function choose(i: number) {
    if (!token || !options[i]) return;
    const value = options[i].value,
      next = text.slice(0, token.start) + value + text.slice(token.end);
    change(next);
    setCursor(token.start + value.length);
    setIndex(0);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        token.start + value.length,
        token.start + value.length,
      );
    });
  }
  function keydown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      e.nativeEvent.isComposing ||
      composing.current ||
      e.keyCode === 229 ||
      !options.length
    )
      return false;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(signature);
      return true;
    }
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      setIndex(
        (selected + (e.key === "ArrowDown" ? 1 : options.length - 1)) %
          options.length,
      );
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      choose(selected);
      return true;
    }
    return false;
  }
  return {
    keydown,
    props: {
      role: "combobox" as const,
      "aria-autocomplete": "list" as const,
      "aria-expanded": !!options.length,
      "aria-controls": options.length ? id : undefined,
      "aria-activedescendant": options.length ? `${id}-${selected}` : undefined,
      onSelect: () => {
        setCursor(input.current?.selectionStart || 0);
        setIndex(0);
      },
      onCompositionStart: () => {
        composing.current = true;
        setDismissed(signature);
      },
      onCompositionEnd: () => {
        composing.current = false;
        setCursor(input.current?.selectionStart || 0);
      },
    },
    list: (
      <>
        {options.length > 0 && (
          <div
            className="messaging-completions"
            role="listbox"
            id={id}
            aria-label={
              token?.kind === "@" ? "Mention suggestions" : "Emoji suggestions"
            }
          >
            {options.map((o, i) => (
              <button
                type="button"
                role="option"
                id={`${id}-${i}`}
                aria-selected={selected === i}
                key={o.value}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        {needsEmoji && error && <p role="status">{error}</p>}
      </>
    ),
  };
}
