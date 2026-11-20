import type { Account } from "../types";

// Reserved, non-routable origin. request() always handles this origin locally,
// including unsupported operations; it must never fall through to fetch().
export const DEMO_ORIGIN = "https://demo.zoomerlip.invalid";
export const demoAccount: Account = {
  id: `${DEMO_ORIGIN}|1`,
  url: DEMO_ORIGIN,
  email: "alex@example.invalid",
  apiKey: "",
  name: "Proof Club",
  userId: 1,
};
export const isDemo = (account: Pick<Account, "url">) =>
  account.url === DEMO_ORIGIN;
