// Who may join and leave a club (#121). A club belongs to one institution,
// and only its people may join: teachers (the institution's admins and
// coordinators, #73/#74) and students (enrolled through it, #75; a 13-17
// year old on their own linked login, #81). An under-13 has no login, so
// has no path here. Joining is open only while the club is approved;
// leaving is always open to a member.
//
// Loads under plain Node (schema, seed script), so no "server-only" here.

import type { ClubStatus } from "./status";

/** How someone belongs to an institution, as a club sees it. */
export type ClubRole = "teacher" | "student";

/** Institution ids where a person teaches or studies, loaded per request. */
export type Affiliations = {
  teacherOf: ReadonlySet<string>;
  studentOf: ReadonlySet<string>;
};

/** Their place at `institutionId`. Teacher wins when they are both. */
export function affiliationAt(
  institutionId: string,
  affiliations: Affiliations
): ClubRole | null {
  if (affiliations.teacherOf.has(institutionId)) return "teacher";
  if (affiliations.studentOf.has(institutionId)) return "student";
  return null;
}

export type JoinDecision =
  | { ok: true }
  | {
      ok: false;
      error: "club_not_open" | "not_at_institution" | "already_member";
    };

export function decideJoin(input: {
  clubStatus: ClubStatus;
  /** Their place at the club's institution. */
  role: ClubRole | null;
  alreadyMember: boolean;
}): JoinDecision {
  if (input.clubStatus !== "approved") {
    return { ok: false, error: "club_not_open" };
  }
  if (input.role === null) return { ok: false, error: "not_at_institution" };
  if (input.alreadyMember) return { ok: false, error: "already_member" };
  return { ok: true };
}

export type LeaveDecision = { ok: true } | { ok: false; error: "not_member" };

export function decideLeave(input: { alreadyMember: boolean }): LeaveDecision {
  return input.alreadyMember
    ? { ok: true }
    : { ok: false, error: "not_member" };
}
