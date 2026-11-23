// Who may keep the breach log (#116): its rules in the platform policy
// (src/server/access/policies.ts).
//
// FOA's own administrators handle a personal-data breach: a super admin
// and, by default, a staff admin (issues-M5 #116, G5). Both are staff
// roles, so #60's second factor guards every step. Telling people or the
// authority, and closing a breach, also ask for a fresh second factor
// (step-up): they send messages in FOA's name, or end the record.
//
// No other role is named, so finance, content managers, safeguarding
// leads, members and visitors are refused.
//
// Loads under plain Node (the bootstrap command reads the platform
// policy): relative imports only, no "server-only".

import {
  role,
  stepUp,
  type Policy,
  type Rule,
} from "../../access/domain/policy";

/** One action per breach use case. */
export const BREACH_ACTIONS = [
  "breach.record",
  "breach.update",
  "breach.note",
  "breach.contain",
  "breach.notify",
  "breach.close",
  "breach.read",
] as const;

export type BreachAction = (typeof BREACH_ACTIONS)[number];

const breachStaff: Rule = role("super_admin", "staff_admin");

export const BREACHES_POLICY = {
  "breach.record": breachStaff,
  "breach.update": breachStaff,
  "breach.note": breachStaff,
  "breach.contain": breachStaff,
  "breach.notify": stepUp(breachStaff),
  "breach.close": stepUp(breachStaff),
  "breach.read": breachStaff,
} satisfies Policy<BreachAction>;
