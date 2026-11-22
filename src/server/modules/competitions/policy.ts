// Who may run the competition use cases (#70). Competition managers create
// (global grant only), list, edit, preview and publish; a grant scoped to
// one competition covers that competition alone. Super admin is not a
// wildcard. Anyone, signed in or not, reads published competitions. Only
// the worker moves a status on schedule (#71): nobody opens or closes
// registration by hand.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  role,
  system,
  type Decision,
  type Policy,
  type Rule,
} from "../../access/domain/policy";

const ALLOWED_TO_ANYONE: Decision = { allowed: true, role: null };

/** Allows everyone: visitors, users and the platform. */
const anyone: Rule = () => ALLOWED_TO_ANYONE;

/**
 * Allows a competition manager at any scope; the use case then shows only
 * the competitions their grants cover.
 */
const competitionManagerAnywhere: Rule = (subject) =>
  subject.kind === "user" &&
  subject.grants.some((grant) => grant.role === "competition_manager")
    ? { allowed: true, role: "competition_manager" }
    : { allowed: false };

export const COMPETITIONS_POLICY = {
  "competition.create": role("competition_manager"),
  "competition.list": competitionManagerAnywhere,
  /** Opening a competition in the admin form and saving it. */
  "competition.edit": role("competition_manager"),
  "competition.preview": role("competition_manager"),
  "competition.publish": role("competition_manager"),
  "competition.read_published": anyone,
  /** A status job arriving at its key date (#71). */
  "competition.advance_status": system("worker"),
} satisfies Policy<string>;

export type CompetitionsAction = keyof typeof COMPETITIONS_POLICY;
