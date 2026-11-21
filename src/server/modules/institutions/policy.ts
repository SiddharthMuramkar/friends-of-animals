// Who may run the institution use cases (#73): their rules in the platform
// policy (src/server/access/policies.ts). Anyone signed in may register an
// institution and see the one they registered; FOA's staff admins and
// super admins review and decide. The institution's own admin can't decide
// about it.

import { role, signedIn, type Policy } from "../../access/domain/policy";

const foaAdmin = role("staff_admin", "super_admin");

export const INSTITUTIONS_POLICY = {
  "institution.register": signedIn,
  /** The institution the signed-in user registered; the query is theirs. */
  "institution.view-own": signedIn,
  "institution.list": foaAdmin,
  "institution.review": foaAdmin,
  "institution.decide": foaAdmin,
} satisfies Policy<string>;

export type InstitutionsAction = keyof typeof INSTITUTIONS_POLICY;
