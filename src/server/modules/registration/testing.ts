// Shared set-up for the registration module's Seam 1 tests. Test code
// only; nothing in the app imports it.

import { eq } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import { competitionAgeGroup } from "@/server/db/schema";
import type { SeedCompetitionOptions } from "@/server/seed/competitions";
import type { Harness } from "@/test/harness";
import { makeCoordinator, seedInstitution } from "@/test/institutions";

/** A signed-in coordinator of `institutionId`. */
export async function signInCoordinator(
  h: Harness,
  institutionId: string,
  details: { name?: string; email?: string } = {},
  meta?: { ip?: string; userAgent?: string }
): Promise<{ actor: Actor; userId: string }> {
  const teacher = await h.seed.member(details);
  await makeCoordinator(h, teacher, institutionId);
  return { actor: await h.signIn(teacher, meta), userId: teacher.id };
}

/**
 * A competition taking institutions with registration open now: its key
 * dates are the seed's, 20 days behind and 55 days ahead of the clock.
 */
export function openCompetition(
  h: Harness,
  options: SeedCompetitionOptions = {}
) {
  return h.seed.competition({
    status: "registration_open",
    participation: "institutions",
    ...options,
  });
}

/** Two age groups with a 1 June 2027 cut-off, as the #75 brief's fixtures. */
export const STUDENT_AGE_GROUPS = [
  { label: "6–9", minAge: 6, maxAge: 9 },
  { label: "10–13", minAge: 10, maxAge: 13 },
];
export const STUDENT_AGE_CUTOFF = "2027-06-01";

/**
 * A child of 10 on the cut-off day (9 on the harness's 15 January 2027),
 * with a guardian, as a coordinator types it.
 */
export const AANYA = {
  fullName: "Aanya  Rao",
  dateOfBirth: "2017-06-01",
  grade: "Class 4",
  guardianName: "Kavita Rao",
  guardianRelationship: "parent",
  guardianPhone: "90000 00301",
  guardianEmail: "kavita.rao@example.test",
  address: "4 Banyan Lane, Kothrud",
};

/**
 * A verified institution registered, by its coordinator, for a competition
 * taking institutions with registration open, the student fixtures' age
 * groups and cut-off. Its age groups come back by label.
 */
export async function registeredSchool(
  h: Harness,
  options: {
    name?: string;
    coordinatorMeta?: { ip?: string; userAgent?: string };
    competition?: SeedCompetitionOptions;
  } = {}
) {
  const { institution, admin } = await seedInstitution(h, {
    name: options.name ?? "Test School",
  });
  const coordinator = await signInCoordinator(
    h,
    institution.id,
    {},
    options.coordinatorMeta
  );
  const competition = await openCompetition(h, {
    ageGroups: STUDENT_AGE_GROUPS,
    ageCutoffDate: STUDENT_AGE_CUTOFF,
    ...options.competition,
  });
  const registered = await h
    .as(coordinator.actor)
    .registerInstitutionForCompetition({
      institutionId: institution.id,
      competitionId: competition.id,
    });
  if (!registered.ok)
    throw new Error(`Could not register: ${registered.error}`);
  const groups = await h.db
    .select({ id: competitionAgeGroup.id, label: competitionAgeGroup.label })
    .from(competitionAgeGroup)
    .where(eq(competitionAgeGroup.competitionId, competition.id));
  const group = (label: string) => {
    const found = groups.find((each) => each.label === label);
    if (!found) throw new Error(`No age group ${label}`);
    return found;
  };
  return {
    institutionId: institution.id,
    admin,
    coordinator,
    competition,
    reference: registered.reference,
    registrationId: registered.registrationId,
    group,
  };
}
