import { memo, useLayoutEffect, useRef, useState } from "react";
import { resolveUpload as resolvePrivateUpload } from "../uploads";
import { messageFragment } from "../contentCache";
import { observeImage } from "../imageObserver";
import type { Account } from "../types";
export const MessageContent = memo(function MessageContent({
  html,
  account,
}: {
  html: string;
  account: Account;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  // Fill before paint so the conversation can restore its scroll position.
  useLayoutEffect(() => {
    const controller = new AbortController();
    const container = ref.current!;
    container.replaceChildren(messageFragment(html, account.url));
    setError("");
    const resolveUpload = (path: string) =>
      resolvePrivateUpload(account, path, controller.signal);
    const images = [
      ...container.querySelectorAll<HTMLImageElement>("img[data-upload]"),
    ];
    const started = new WeakSet<HTMLImageElement>();
    const loadImage = (img: HTMLImageElement) => {
      if (started.has(img) || controller.signal.aborted) return;
      started.add(img);
      void resolveUpload(img.dataset.upload!)
        .then((url) => {
          if (controller.signal.aborted) return;
          img.loading = "eager";
          img.onerror = () => {
            if (!controller.signal.aborted)
              setError("An attachment could not be loaded.");
          };
          img.src = url;
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError("An attachment could not be loaded.");
        });
    };
    const stopObserving = images.map((img) => {
      if (!img.hasAttribute("width") || !img.hasAttribute("height")) {
        img.style.minHeight = "120px";
        img.style.minWidth = "120px";
      }
      return observeImage(img, container.closest(".message-scroll"), () =>
        loadImage(img),
      );
    });
    const click = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>(
        "a[data-upload]",
      );
      if (!link || (event.type === "auxclick" && event.button !== 1)) return;
      event.preventDefault();
      const popup = window.open("about:blank", "_blank");
      if (popup) popup.opener = null;
      void resolveUpload(link.dataset.upload!)
        .then((url) => {
          if (popup) popup.location.replace(url);
          else setError("Allow popups to open attachments.");
        })
        .catch(() => {
          popup?.close();
          if (!controller.signal.aborted)
            setError("Attachment unavailable. Try again.");
        });
    };
    container.addEventListener("click", click);
    container.addEventListener("auxclick", click);
    return () => {
      controller.abort();
      stopObserving.forEach((stop) => stop());
      container.removeEventListener("click", click);
      container.removeEventListener("auxclick", click);
      container
        .querySelectorAll<HTMLImageElement>("img[data-upload]")
        .forEach((img) => {
          img.onerror = null;
          img.removeAttribute("src");
        });
    };
  }, [html, account]);
  return (
    <>
      <div className="message-content" ref={ref} />
      {error && <small className="error">{error}</small>}
    </>
  );
});
