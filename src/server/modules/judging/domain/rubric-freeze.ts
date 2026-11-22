// How the database tells the app that a rubric is frozen. The trigger in
// drizzle/*_88_rubric_immutability.sql raises this SQLSTATE when anything
// tries to change a rubric that has left draft, or its criteria. Use
// cases map it to `rubric_not_editable`, so a change that slipped past
// their own check (a race) still fails the same way.
//
// A class of our own ("RB"; classes starting I to Z are left to
// applications), so no Postgres error is mistaken for it.
//
// Loads under plain Node (seed script): relative imports only.

import { sqlState } from "../../../errors";

export const RUBRIC_FROZEN_SQLSTATE = "RB001";

/** Whether `error` is the trigger refusing a change to a frozen rubric. */
export function isRubricFrozenError(error: unknown): boolean {
  return sqlState(error) === RUBRIC_FROZEN_SQLSTATE;
}
