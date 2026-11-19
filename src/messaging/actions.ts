import type { Account, Message } from "../types";
export function messageLink(account: Account, message: Pick<Message, "id">) {
  return `${account.url}/#narrow/id/${message.id}`;
}
export function quoteMessage(account: Account, message: Message, raw: string) {
  const name = message.sender_full_name.replace(/[\[\]\\\n\r]/g, "_");
  return `${name} [said](${messageLink(account, message)}):\n${raw
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n`;
}
