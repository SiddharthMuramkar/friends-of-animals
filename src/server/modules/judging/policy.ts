// Who may do what with rubrics (#88). Competition managers write and read
// them, for the competitions their grant covers (one competition, or all
// of them for a global grant).
//
// Loads under plain Node: relative imports only.

import { role, type Policy } from "../../access/domain/policy";

export const JUDGING_POLICY = {
  /** The admin rubric pages: every version, drafts included. */
  "rubric.list": role("competition_manager"),
  /** Create, edit, publish and revise. */
  "rubric.manage": role("competition_manager"),
} satisfies Policy<string>;

export type JudgingAction = keyof typeof JUDGING_POLICY;
