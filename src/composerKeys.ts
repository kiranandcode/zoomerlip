/** A phone or tablet keyboard: no Shift+Enter, so Enter has to insert a newline. */
export function touchPrimary() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches
  );
}
/** Whether this Enter key press sends the message rather than adding a line. */
export function sendsOnEnter(
  event: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    isComposing: boolean;
  },
  touch: boolean,
) {
  if (event.key !== "Enter" || event.isComposing) return false;
  if (event.ctrlKey || event.metaKey) return true;
  return !touch && !event.shiftKey;
}
