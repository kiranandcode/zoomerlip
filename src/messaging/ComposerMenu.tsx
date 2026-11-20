import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function ComposerMenu({
  items,
}: {
  items: { label: string; icon: LucideIcon; action: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  function close(restore = true) {
    setOpen(false);
    if (restore) trigger.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const fit = () => {
      const el = menu.current,
        button = trigger.current;
      if (!el || !button) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop || 0,
        left = viewport?.offsetLeft || 0;
      const width = viewport?.width || innerWidth,
        height = viewport?.height || innerHeight;
      el.style.maxHeight = `${Math.max(48, height - 24)}px`;
      el.style.maxWidth = `${Math.max(120, width - 24)}px`;
      const anchor = button.getBoundingClientRect(),
        rect = el.getBoundingClientRect();
      el.style.left = `${Math.max(left + 12, Math.min(anchor.left, left + width - rect.width - 12))}px`;
      el.style.top = `${Math.max(top + 12, Math.min(anchor.top - rect.height - 8, top + height - rect.height - 12))}px`;
    };
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        close(false);
    };
    fit();
    menu.current
      .querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, true);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit, true);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="composer-icon"
        aria-label="More message options"
        title="More message options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Plus size={22} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="composer-menu"
            role="menu"
            aria-label="Message options"
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Tab") {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                }
                close();
                return;
              }
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button",
                ),
              ];
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }}
          >
            {items.map(({ label, icon: Icon, action }) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  action();
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
