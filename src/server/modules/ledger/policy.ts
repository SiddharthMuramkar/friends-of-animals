import { role, system, type Policy } from "../../access/domain/policy";

const finance = role("finance");
const platform = system("worker", "seed", "cli");

// The platform policy requires the session's second factor for staff roles.
export const LEDGER_POLICY = {
  "ledger.read": finance,
  "ledger.write": finance,
  "ledger.post_payment": platform,
} satisfies Policy<string>;
