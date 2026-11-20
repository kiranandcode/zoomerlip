/** A row must remain visible briefly; merely loading history never reads it. */
export const READ_DWELL_MS = 600;

export function trackReadMessages(
  root: HTMLElement,
  unread: () => ReadonlySet<number>,
  send: (ids: number[], signal: AbortSignal) => Promise<unknown>,
  onError: (error: unknown) => void,
  active: () => boolean,
) {
  const lifetime = new AbortController();
  const candidates = new Map<number, number>();
  // Preserve a deliberate "mark unread" until the row leaves and re-enters.
  const handled = new Set<number>();
  let frame = 0,
    timer = 0,
    busy = false,
    retryAt = 0,
    failures = 0;
  const available = () =>
    !lifetime.signal.aborted &&
    active() &&
    document.visibilityState === "visible" &&
    document.hasFocus() &&
    !root.closest("[inert]");

  function scan() {
    frame = 0;
    window.clearTimeout(timer);
    if (!available()) {
      candidates.clear();
      return;
    }
    const bounds = root.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = Math.max(bounds.top, viewport?.offsetTop ?? 0);
    const bottom = Math.min(
      bounds.bottom,
      (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
    );
    const left = Math.max(bounds.left, 0);
    const right = Math.min(bounds.right, window.innerWidth);
    const visible = new Set<number>();
    const pending = unread();
    const now = Date.now();
    if (bottom > top && right > left) {
      for (const row of root.querySelectorAll<HTMLElement>(
        "article[data-message-id]",
      )) {
        const box = row.getBoundingClientRect();
        const y1 = Math.max(top, box.top),
          y2 = Math.min(bottom, box.bottom);
        if (y2 - y1 < Math.min(24, box.height / 2)) continue;
        const x1 = Math.max(left, box.left),
          x2 = Math.min(right, box.right);
        if (x2 <= x1) continue;
        // An open drawer, dialog or menu is not a view of the message below it.
        const hit = document.elementFromPoint((x1 + x2) / 2, (y1 + y2) / 2);
        if (!hit || !row.contains(hit)) continue;
        const id = Number(row.dataset.messageId);
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        visible.add(id);
        if (!pending.has(id)) {
          handled.add(id);
          candidates.delete(id);
        } else if (!handled.has(id) && !candidates.has(id))
          candidates.set(id, now);
      }
    }
    for (const id of candidates.keys())
      if (!visible.has(id)) candidates.delete(id);
    for (const id of handled) if (!visible.has(id)) handled.delete(id);
    if (busy || !candidates.size) return;
    const due = [...candidates].filter(
      ([, since]) => now - since >= READ_DWELL_MS,
    );
    if (due.length && now >= retryAt) {
      const ids = due.slice(0, 100).map(([id]) => id);
      busy = true;
      void send(ids, lifetime.signal)
        .then(() => {
          if (lifetime.signal.aborted) return;
          for (const id of ids) {
            if (visible.has(id)) handled.add(id);
            candidates.delete(id);
          }
          failures = 0;
          retryAt = 0;
        })
        .catch((error: unknown) => {
          if (lifetime.signal.aborted) return;
          const retryAfter =
            Number((error as { retryAfterMs?: number })?.retryAfterMs) || 0;
          retryAt =
            Date.now() +
            Math.max(retryAfter, Math.min(60_000, 5000 * 2 ** failures++));
          onError(error);
        })
        .finally(() => {
          busy = false;
          refresh();
        });
    } else {
      const earliest = Math.min(...candidates.values()) + READ_DWELL_MS;
      timer = window.setTimeout(
        scan,
        Math.max(1, earliest - now, retryAt - now),
      );
    }
  }
  function refresh() {
    if (!lifetime.signal.aborted && !frame) frame = requestAnimationFrame(scan);
  }
  const resetVisibility = () => {
    candidates.clear();
    refresh();
  };
  root.addEventListener("scroll", refresh, { passive: true });
  root.addEventListener("load", refresh, true);
  window.addEventListener("resize", refresh);
  window.addEventListener("focus", resetVisibility);
  window.addEventListener("blur", resetVisibility);
  document.addEventListener("visibilitychange", resetVisibility);
  const resize =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(refresh);
  resize?.observe(root);
  window.visualViewport?.addEventListener("resize", refresh);
  window.visualViewport?.addEventListener("scroll", refresh);
  refresh();
  return {
    refresh,
    dispose() {
      lifetime.abort();
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      resize?.disconnect();
      root.removeEventListener("scroll", refresh);
      root.removeEventListener("load", refresh, true);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("focus", resetVisibility);
      window.removeEventListener("blur", resetVisibility);
      document.removeEventListener("visibilitychange", resetVisibility);
      window.visualViewport?.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("scroll", refresh);
    },
  };
}
