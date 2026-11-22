// Who may do what with rubrics (#88). Competition managers write and read
// them, for the competitions their grant covers (one competition, or all
// of them for a global grant). Coordinators and admins of registered
// institutions read the published ones in the judging guide.
//
// Loads under plain Node: relative imports only.

import { role, type Policy } from "../../access/domain/policy";

export const JUDGING_POLICY = {
  /** The admin rubric pages: every version, drafts included. */
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
