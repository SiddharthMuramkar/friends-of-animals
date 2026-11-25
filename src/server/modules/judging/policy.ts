// Who may do what with rubrics (#88). Competition managers write and read
// them, for the competitions their grant covers (one competition, or all
// of them for a global grant). Coordinators and admins of registered
// institutions read the published ones in the judging guide.
//
// Loads under plain Node: relative imports only.

import {
  role,
  signedIn,
  type Rule,
  type Policy,
} from "../../access/domain/policy";

// Unlike generic role policies, a judge needs the exact round grant.
const roundJudge: Rule = (subject, resource) =>
  subject.kind === "user" &&
  subject.grants.some(
    (g) =>
      g.role === "judge" &&
      g.scope.type === "round" &&
      resource.scopes?.some(
        (s) => s.type === "round" && s.id === (g.scope as { id: string }).id
      )
  )
    ? { allowed: true, role: "judge" }
    : { allowed: false };
export const JUDGING_POLICY = {
  /** The admin rubric pages: every version, drafts included. */
  "judge.invitation.view": (subject) =>
    subject.kind !== "system"
      ? { allowed: true, role: null }
      : { allowed: false },
  "judge.invitation.respond": signedIn,
  "judge.rounds.list": signedIn,
  "judge.onboard": roundJudge,
  "score.read": roundJudge,
  "score.write": roundJudge,
  "judging.round.lock": role(
    "competition_manager",
    "staff_admin",
    "super_admin"
  ),
  "judging.round.override": role("staff_admin", "super_admin"),
  "judging.round.tag": role("competition_manager"),
  "judging.round.manage": role("competition_manager"),
  "judging.round.read": role(
    "competition_manager",
    "staff_admin",
    "super_admin"
  ),
  "rubric.list": role("competition_manager"),
  /** Create, edit, publish and revise. */
  "rubric.manage": role("competition_manager"),
  /**
   * The judging guide: published rubrics only. The use case passes the
   * registered institutions the actor acts for as the scopes.
   */
  "judgingGuide.read": role("institution_coordinator", "institution_admin"),
} satisfies Policy<string>;

export type JudgingAction = keyof typeof JUDGING_POLICY;
