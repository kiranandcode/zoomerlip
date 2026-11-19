/** The message row at the top of a scroller, and how far it sits from the top edge. */
export type ReadingAnchor = { id: string; top: number };
const ROWS = "article[data-message-id]";
export function readingAnchor(scroller: HTMLElement): ReadingAnchor | null {
  const rows = scroller.querySelectorAll<HTMLElement>(ROWS),
    top = scroller.getBoundingClientRect().top;
  // Rows are in document order, so the first one still in view is found by bisection.
  let low = 0,
    high = rows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (rows[mid].getBoundingClientRect().bottom > top) high = mid;
    else low = mid + 1;
  }
  const row = rows[low];
  return row
    ? {
        id: row.dataset.messageId!,
        top: row.getBoundingClientRect().top - top,
      }
    : null;
}
/** Scrolls so the anchored row is back where it was. False if the row is gone. */
export function restoreAnchor(
  scroller: HTMLElement,
  anchor: ReadingAnchor,
): boolean {
  const row = [...scroller.querySelectorAll<HTMLElement>(ROWS)].find(
    (r) => r.dataset.messageId === anchor.id,
  );
  if (!row) return false;
  const delta =
    row.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top -
    anchor.top;
  if (delta) scroller.scrollTop += delta;
  return true;
}
