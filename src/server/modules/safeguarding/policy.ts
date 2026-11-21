// Who may file and handle safeguarding reports (#116): their rules in the
// platform policy (src/server/access/policies.ts).
//
// Anyone may file a concern, signed in or not. Everything else is for the
// safeguarding lead alone: reading the queue or a report, moving it on,
// assigning it and writing in its incident log. No other role is named, not
// even super admin (the policy has no wildcard), so a report about a staff
// member never reaches that staff member. The role is granted globally
// only, and it is a staff role, so #60's second factor guards it too.
//
// Loads under plain Node (the bootstrap command reads the platform
// policy): relative imports only, no "server-only".

import {
  anyOf,
  role,
  signedIn,
  signedOut,
  type Policy,
  type Rule,
} from "../../access/domain/policy";

/** The lead's use cases, one action each. */
export const SAFEGUARDING_LEAD_ACTIONS = [
  "safeguarding.list",
  "safeguarding.view",
  "safeguarding.transition",
  "safeguarding.assign",
  "safeguarding.add-note",
] as const;

export type SafeguardingLeadAction = (typeof SAFEGUARDING_LEAD_ACTIONS)[number];

const leadOnly: Rule = role("safeguarding_lead");

export const SAFEGUARDING_POLICY = {
  /** The public form: a visitor or any signed-in user. */
  "safeguarding-concern.submit": anyOf(signedOut, signedIn),
  ...(Object.fromEntries(
    SAFEGUARDING_LEAD_ACTIONS.map((action) => [action, leadOnly])
  ) as Record<SafeguardingLeadAction, Rule>),
} satisfies Policy<string>;

export type SafeguardingAction = keyof typeof SAFEGUARDING_POLICY;
