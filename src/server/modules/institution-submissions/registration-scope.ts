// The institution registration a coordinator's submission pages are about
// (#87), found by its reference within the institution the actor acts for,
// as #75's enrolment pages find it: a reference of another institution
// finds nothing, exactly like one that doesn't exist. With it, what these
// pages show about it: the institution's and competition's names, the
// competition's status and digital submission scope, and how many of its
// students are confirmed.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, count, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  competition,
  institution,
  institutionRegistration,
  registration,
} from "../../db/schema";
import type {
  CompetitionStatus,
  DigitalScope,
} from "../competitions/domain/vocabulary";
import { parseInstitutionRegistrationReference } from "../registration/domain/institution-registration-reference";

export type RegistrationScope = {
  id: string;
  reference: string;
  institutionId: string;
  institutionName: string;
  competition: {
    id: string;
    code: string;
    name: string;
    status: CompetitionStatus;
    digitalScope: DigitalScope;
  };
  confirmedStudents: number;
};

/**
 * The registration `reference` names at `institutionId`, or null. With
 * `lock`, its competition is share-locked, so a cancellation waits for
 * this transaction or is seen by it.
 */
export async function loadRegistrationScope(
  db: AppDb,
  input: { institutionId: string; reference: string },
  { lock = false }: { lock?: boolean } = {}
): Promise<RegistrationScope | null> {
  const typed = parseInstitutionRegistrationReference(input.reference);
  if (!typed) return null;
  const query = db
    .select({
      id: institutionRegistration.id,
      reference: institutionRegistration.reference,
      institutionId: institutionRegistration.institutionId,
      institutionName: institution.name,
      competitionId: competition.id,
      code: competition.code,
      name: competition.name,
      status: competition.status,
      digitalScope: competition.digitalScope,
    })
    .from(institutionRegistration)
    .innerJoin(
      institution,
      eq(institution.id, institutionRegistration.institutionId)
    )
    .innerJoin(
      competition,
      eq(competition.id, institutionRegistration.competitionId)
    )
    .where(
      and(
        eq(institutionRegistration.reference, typed.reference),
        eq(institutionRegistration.institutionId, input.institutionId)
      )
    );
  const [row] = lock
    ? await query.for("share", { of: competition })
    : await query;
  if (!row) return null;
  const [confirmed] = await db
    .select({ n: count() })
    .from(registration)
    .where(
      and(
        eq(registration.institutionRegistrationId, row.id),
        eq(registration.status, "confirmed")
      )
    );
  return {
    id: row.id,
    reference: row.reference,
    institutionId: row.institutionId,
    institutionName: row.institutionName,
    competition: {
      id: row.competitionId,
      code: row.code,
      name: row.name,
      status: row.status,
      digitalScope: row.digitalScope,
    },
    confirmedStudents: confirmed?.n ?? 0,
  };
}
