// Applying to start a club (#121). A student or teacher applies for their
// own institution, which must be verified (#73). One undecided application
// per person per institution. Applying is allowed even when the institution
// already has its maximum of clubs: the limit is checked at approval, when
// the community manager may have raised `clubs.maxPerInstitution`.
//
// Loads under plain Node (schema, seed script), so no "server-only" here.

import { z } from "zod";

import type { ClubRole } from "./membership";

export const CLUB_NAME_MIN_LENGTH = 3;
export const CLUB_NAME_MAX_LENGTH = 80;

/** A club's name: trimmed, with runs of whitespace made one space. */
export const clubNameSchema = z
  .string()
  .transform((name) => name.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(CLUB_NAME_MIN_LENGTH).max(CLUB_NAME_MAX_LENGTH));

export type ClubApplicationDecision =
  | { ok: true; applicantKind: ClubRole }
  | {
      ok: false;
      error:
        | "institution_not_verified"
        | "not_at_institution"
        | "application_pending";
    };

export function decideClubApplication(input: {
  institutionVerified: boolean;
  /** The applicant's place at the institution. */
  role: ClubRole | null;
  /** They already have an application there in status `applied`. */
  hasPendingApplication: boolean;
}): ClubApplicationDecision {
  if (!input.institutionVerified) {
    return { ok: false, error: "institution_not_verified" };
  }
  if (input.role === null) return { ok: false, error: "not_at_institution" };
  if (input.hasPendingApplication) {
    return { ok: false, error: "application_pending" };
  }
  return { ok: true, applicantKind: input.role };
}
