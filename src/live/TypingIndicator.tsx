import type { Account, User, View } from "../types";
import { conversationKey, useLive } from "./store";
export function TypingIndicator({
  account,
  view,
  users,
}: {
  account: Account;
  view: View;
  users: User[];
}) {
  const state = useLive(account);
  const key = conversationKey(view, account.userId);
  const names = state.typing
    .filter((t) => t.key === key && t.until > Date.now())
    .slice(0, 3)
    .map(
      (t) => users.find((u) => u.user_id === t.user)?.full_name || "Someone",
    );
  return (
    <div className="typing-indicator" role="status" aria-live="polite">
      {names.length
        ? `${names.join(", ")} ${names.length === 1 ? "is" : "are"} typing…`
        : ""}
    </div>
  );
}
