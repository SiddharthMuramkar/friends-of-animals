// Who may run the volunteers module's use cases (#123): their rules in the
// platform policy (src/server/access/policies.ts).
//
// Any signed-in member may apply, read their own application and accept a
// newer version of a declaration; the use cases match the actor's own rows
// only. A 14- to 17-year-old's application is decided first by a verified
// guardian linked to the teen's profile, who also reads it from the
// child's page: the use case names the acting user as the owner only when
// such a link joins them (./access.ts). The applicant, or that guardian,
// may withdraw an open application. Community managers (and super admins)
// read the queue and decide; approving grants a role, so it needs step-up.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  owner,
  role,
  signedIn,
  stepUp,
  type Decision,
  type Policy,
  type Rule,
} from "../../access/domain/policy";

const REFUSED: Decision = { allowed: false };

/**
 * A guardian (the role) acting on an application or child they are linked
 * to: the use case names the acting user as its owner only then.
 */
const linkedGuardian: Rule = (subject, resource) => {
  const held = role("guardian")(subject, resource);
  return held.allowed && owner(subject, resource).allowed ? held : REFUSED;
};

const reviewers = role("community_manager", "super_admin");

export const VOLUNTEERS_POLICY = {
  // Applying, reading one's own and accepting a newer declaration.
  "volunteer.apply": signedIn,
  "volunteer.view_own": signedIn,
  // The applicant's verified guardian, for a 14- to 17-year-old.
  "volunteer.guardian_decide": linkedGuardian,
  "volunteer.child.view": linkedGuardian,
  // The applicant, or their verified guardian: the use case names either
  // as the owner.
  "volunteer.withdraw": owner,
  // The community team's queue.
  "volunteer.review": reviewers,
  "volunteer.decline": reviewers,
  // Approving grants the volunteer role: a fresh second factor first.
  "volunteer.approve": stepUp(reviewers),
} satisfies Policy<string>;
