import { role, stepUp, system, type Policy } from "../../access/domain/policy";

const finance = role("finance");
const platform = system("worker", "seed", "cli");

// The platform policy requires the session's second factor for staff roles.
export const LEDGER_POLICY = {
  "ledger.read": finance,
  "ledger.write": finance,
  "ledger.post_payment": platform,
  // Period lock and the two-approver rule (#109). Asking, rejecting and
  // cancelling need the session's second factor; approving runs the money
  // operation, so it needs a fresh one.
  "ledger.period_request": finance,
  "ledger.approval_approve": stepUp(finance),
  "ledger.approval_decide": finance,
  "ledger.approval_expire": platform,
} satisfies Policy<string>;
