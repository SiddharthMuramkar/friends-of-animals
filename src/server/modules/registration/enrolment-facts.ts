// What enrolling, withdrawing and the coordinator dashboard (#75) load
// about one institution registration: the registration itself, found by
// its reference within the institution the actor acts for, its
// institution and competition, and whether students can be enrolled now.
//
// The reference is read as a URL or a person may carry it (any case, the
// look-alikes O, I and L). A reference from another institution finds
// nothing, exactly like one that doesn't exist, so a coordinator learns
// nothing about other schools.

import { and, asc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionAgeGroup,
  competitionKeyDate,
  institution,
  institutionRegistration,
} from "../../db/schema";
import type { AgeGroup } from "./domain/age-group";
import { parseInstitutionRegistrationReference } from "./domain/institution-registration-reference";
import { enrolmentState, type EnrolmentState } from "./domain/enrolment-state";
import { registrationWindow } from "./domain/registration-window";

export type EnrolmentFacts = {
  institutionRegistration: {
    id: string;
    institutionId: string;
    competitionId: string;
    reference: string;
  };
  institution: {
    name: string;
    pinCode: string;
    city: string;
    state: string;
  };
  competition: {
    code: string;
    name: string;
    /** `YYYY-MM-DD`; every published competition has one. */
    ageCutoffDate: string;
  };
  enrolment: EnrolmentState;
};

/**
 * The facts for `reference` at `institutionId`, or null. With `lock`, the
 * registration is locked so enrolments in it run one at a time (the
 * duplicate check then sees every earlier one), and the institution and
 * competition are share-locked, so a suspension or a status job waits for
 * this transaction or is seen by it.
 */
export async function loadEnrolmentFacts(
  db: AppDb,
  input: { institutionId: string; reference: string },
  now: Date,
  { lock }: { lock: boolean }
): Promise<EnrolmentFacts | null> {
  const typed = parseInstitutionRegistrationReference(input.reference);
  if (!typed) return null;
  const registrationQuery = db
    .select({
      id: institutionRegistration.id,
      institutionId: institutionRegistration.institutionId,
      competitionId: institutionRegistration.competitionId,
      reference: institutionRegistration.reference,
    })
    .from(institutionRegistration)
    .where(
      and(
        eq(institutionRegistration.reference, typed.reference),
        eq(institutionRegistration.institutionId, input.institutionId)
      )
    );
  const [found] = lock
    ? await registrationQuery.for("no key update")
    : await registrationQuery;
  if (!found) return null;

  const institutionQuery = db
    .select({
      name: institution.name,
      status: institution.status,
      pinCode: institution.pinCode,
      city: institution.city,
      state: institution.state,
    })
    .from(institution)
    .where(eq(institution.id, found.institutionId));
  const competitionQuery = db
    .select({
      code: competition.code,
      name: competition.name,
      status: competition.status,
      ageCutoffDate: competition.ageCutoffDate,
    })
    .from(competition)
    .where(eq(competition.id, found.competitionId));
  const [school] = lock
    ? await institutionQuery.for("share")
    : await institutionQuery;
  const [target] = lock
    ? await competitionQuery.for("share")
    : await competitionQuery;
  if (!school || !target) return null;
  if (target.ageCutoffDate === null) {
    throw new Error("A registered competition has no age cut-off date");
  }
  const [closes] = await db
    .select({ at: competitionKeyDate.at })
    .from(competitionKeyDate)
    .where(
      and(
        eq(competitionKeyDate.competitionId, found.competitionId),
        eq(competitionKeyDate.kind, "registration_closes")
      )
    );

  const { status: institutionStatus, ...institutionDetails } = school;
  return {
    institutionRegistration: found,
    institution: institutionDetails,
    competition: {
      code: target.code,
      name: target.name,
      ageCutoffDate: target.ageCutoffDate,
    },
    enrolment: enrolmentState({
      window: registrationWindow(
        { status: target.status, registrationClosesAt: closes?.at ?? null },
        now
      ),
      institutionStatus,
    }),
  };
}

/** The competition's age groups, in the order its manager listed them. */
export function ageGroupsOf(
  db: AppDb,
  competitionId: string
): Promise<AgeGroup[]> {
  return db
    .select({
      id: competitionAgeGroup.id,
      label: competitionAgeGroup.label,
      minAge: competitionAgeGroup.minAge,
      maxAge: competitionAgeGroup.maxAge,
    })
    .from(competitionAgeGroup)
    .where(eq(competitionAgeGroup.competitionId, competitionId))
    .orderBy(asc(competitionAgeGroup.position));
}
