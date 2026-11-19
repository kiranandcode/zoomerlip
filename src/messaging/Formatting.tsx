import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { request } from "../api";
import { MessageContent } from "../components/MessageContent";
import type { Account } from "../types";
import { formatSelection } from "./completion";
export function Formatting({
  account,
  text,
  input,
  onChange,
}: {
  account: Account;
  text: string;
  input: RefObject<HTMLTextAreaElement | null>;
  onChange: (text: string) => void;
}) {
  const [preview, setPreview] = useState(false),
    [html, setHtml] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const control = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    setHtml("");
    setPreview(false);
    control.current?.abort();
    setBusy(false);
    return () => control.current?.abort();
  }, [text]);
  useEffect(() => {
    const reset = (e: Event) => {
      if ((e as CustomEvent).detail.accountId === account.id) {
        control.current?.abort();
        setHtml("");
        setPreview(false);
      }
    };
    window.addEventListener("zoomerlip-messaging-reset", reset);
    return () => window.removeEventListener("zoomerlip-messaging-reset", reset);
  }, [account.id]);
  const formats = [
    ["Bold", "**", "**"],
    ["Italic", "*", "*"],
    ["Code", "`", "`"],
    ["Quote", "\n> ", ""],
    ["List", "\n* ", ""],
    ["Link", "[", "](https://)"],
  ] as const;
  return (
    <>
      <div className="messaging-tools" aria-label="Formatting">
        {formats.map(([name, before, after]) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              const d = formatSelection(
                text,
                input.current?.selectionStart || 0,
                input.current?.selectionEnd || 0,
                before,
                after,
              );
              onChange(d.text);
              requestAnimationFrame(() => {
                input.current?.focus();
                input.current?.setSelectionRange(d.start, d.end);
              });
            }}
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          disabled={!text.trim() || busy}
          onClick={async () => {
            if (preview) {
              setPreview(false);
              return;
            }
            control.current?.abort();
            const c = new AbortController();
            control.current = c;
            setBusy(true);
            setError("");
            try {
              const d = await request<{ rendered: string }>(
                account,
                "/messages/render",
                { content: text },
                "POST",
                c.signal,
              );
              if (!c.signal.aborted) {
                setHtml(d.rendered);
                setPreview(true);
              }
            } catch (e) {
              if (!c.signal.aborted)
                setError(
                  e instanceof Error ? e.message : "Preview unavailable.",
                );
            } finally {
              if (!c.signal.aborted) setBusy(false);
            }
          }}
        >
          {busy ? "Rendering…" : preview ? "Close preview" : "Preview"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <section className="messaging-panel" aria-label="Markdown preview">
          <MessageContent account={account} html={html} />
        </section>
      )}
    </>
  );
}
