// Registration seed data (#75): the seeded verified institution registered
// for the seeded open competition (NEIGH27), under a fixed id and
// reference so links and journeys can name them, with six students
// enrolled across its age groups and one withdrawn. The students are
// fictional, with example.test emails and +91 90000 051xx numbers, and go
// through the same rules as a coordinator's (prepareStudent). Seed data
// sends nothing and names nobody as having registered or enrolled. Also
// the `h.seed.institutionRegistration()` builder.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { and, eq } from "drizzle-orm";

import {
  competition,
  institution,
  INSTITUTION_REGISTRATION_REFERENCE_UNIQUE,
  institutionRegistration,
  participantProfile,
  registration,
} from "../db/schema";
import { uuidv7 } from "../ids";
import { withUniqueCode } from "../modules/codes/codes";
import { indianDateAt } from "../modules/registration/domain/calendar-date";
import { REFERENCE_SYMBOL_COUNT } from "../modules/registration/domain/institution-registration-reference";
import { prepareStudent } from "../modules/registration/domain/prepare-student";
import type { RegistrationStatus } from "../modules/registration/domain/registration-status";
import type { StudentInput } from "../modules/registration/domain/student-details";
import { ageGroupsOf } from "../modules/registration/enrolment-facts";
import {
  normaliseStudentPhone,
  studentColumns,
} from "../modules/registration/student-profile";
import { SEED_INSTITUTIONS } from "./institutions";
import type { SeedDeps } from "./types";

export const SEED_REGISTRATIONS = {
  /** The verified institution, for "Neighbours on My Street". */
  institution: {
    id: "01938a00-0000-7000-8000-000000005001",
    institutionId: SEED_INSTITUTIONS.verified.id,
    // The competitions seed's open competition, NEIGH27.
    competitionId: "01938a00-0000-7000-8000-000000002101",
    reference: "NEIGH27-I-5EED1",
  },
} as const;

type SeedStudent = Required<
  Pick<
    StudentInput,
    | "fullName"
    | "dateOfBirth"
    | "grade"
    | "guardianName"
    | "guardianRelationship"
    | "guardianPhone"
    | "guardianEmail"
  >
> &
  StudentInput & {
    profileId: string;
    registrationId: string;
    status: RegistrationStatus;
  };

/**
 * NEIGH27's students. Its children's age groups are 5–8, 9–12 and 13–17 on
 * 1 January 2027 (and Adults, for #78); these are in the two youngest, so
 * they stay minors for years.
 */
export const SEED_STUDENTS: readonly SeedStudent[] = [
  ["Aarav Kulkarni", "2019-03-14", "Class 2", "Sneha Kulkarni", "parent", "01"],
  ["Diya Nair", "2018-08-22", "Class 3", "Ramesh Nair", "parent", "02"],
  [
    "Kabir Joshi",
    "2020-11-05",
    "Class 1",
    "Pooja Joshi",
    "legal_guardian",
    "03",
  ],
  ["Meher Iyer", "2016-05-30", "Class 5", "Lakshmi Iyer", "parent", "04"],
  ["Arjun Bhat", "2015-01-19", "Class 6", "Vinod Bhat", "parent", "05"],
  ["Sara D'Souza", "2014-07-07", "Class 7", "Anita D'Souza", "parent", "06"],
  ["Rohan Patil", "2017-02-11", "Class 4", "Sachin Patil", "parent", "07"],
].map(
  ([fullName, dateOfBirth, grade, guardianName, guardianRelationship, n]) => ({
    profileId: `01938a00-0000-7000-8000-0000000051${n}`,
    registrationId: `01938a00-0000-7000-8000-0000000052${n}`,
    // The last one changed their mind.
    status: n === "07" ? "withdrawn" : "enrolled",
    fullName: fullName!,
    dateOfBirth: dateOfBirth!,
    grade: grade!,
    guardianName: guardianName!,
    guardianRelationship: guardianRelationship!,
    guardianPhone: `+91 90000 051${n}`,
    guardianEmail: `${guardianName!.split(" ")[0]!.toLowerCase()}.guardian@example.test`,
  })
);

/** Enrols SEED_STUDENTS under the seeded registration. */
async function seedStudents(deps: SeedDeps): Promise<void> {
  const seed = SEED_REGISTRATIONS.institution;
  const [registered] = await deps.db
    .select({ id: institutionRegistration.id })
    .from(institutionRegistration)
    .where(eq(institutionRegistration.id, seed.id));
  const [target] = await deps.db
    .select({ ageCutoffDate: competition.ageCutoffDate })
    .from(competition)
    .where(eq(competition.id, seed.competitionId));
  const [school] = await deps.db
    .select({
      pinCode: institution.pinCode,
      city: institution.city,
      state: institution.state,
    })
    .from(institution)
    .where(eq(institution.id, seed.institutionId));
  if (!registered || !target?.ageCutoffDate || !school) return;
  const now = deps.clock.now();
  const context = {
    ageCutoffDate: target.ageCutoffDate,
    ageGroups: await ageGroupsOf(deps.db, seed.competitionId),
    today: indianDateAt(now),
    institutionDefaults: school,
  };

  for (const student of SEED_STUDENTS) {
    const prepared = prepareStudent(context, student, {
      normalisePhone: normaliseStudentPhone,
      blindIndex: deps.blindIndex,
    });
    if (!prepared.ok) {
      throw new Error(`Seed student ${student.fullName} is refused`);
    }
    // Skipped if a coordinator on the preview enrolled the child already.
    const [profile] = await deps.db
      .insert(participantProfile)
      .values({
        id: student.profileId,
        ownerKind: "institution",
        managingInstitutionId: seed.institutionId,
        ...studentColumns(deps, prepared.student.details),
        identityHash: prepared.student.identityHash,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: participantProfile.id });
    const [kept] = profile
      ? [profile]
      : await deps.db
          .select({ id: participantProfile.id })
          .from(participantProfile)
          .where(eq(participantProfile.id, student.profileId));
    if (!kept) continue;
    await deps.db
      .insert(registration)
      .values({
        id: student.registrationId,
        participantProfileId: kept.id,
        competitionId: seed.competitionId,
        route: "institution",
        institutionRegistrationId: seed.id,
        ageGroupId: prepared.student.ageGroup.id,
        status: student.status,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
}

/**
 * The registration and its students, after the institutions and
 * competitions seeds, while its institution is verified. Running again
 * changes nothing.
 */
export async function seedRegistrations(deps: SeedDeps): Promise<void> {
  const seed = SEED_REGISTRATIONS.institution;
  const [verified] = await deps.db
    .select({ id: institution.id })
    .from(institution)
    .where(
      and(
        eq(institution.id, seed.institutionId),
        eq(institution.status, "verified")
      )
    );
  const [open] = await deps.db
    .select({ id: competition.id })
    .from(competition)
    .where(eq(competition.id, seed.competitionId));
  if (!verified || !open) return;
  const now = deps.clock.now();
  // Also skips it if someone registered the pair on the preview already.
  await deps.db
    .insert(institutionRegistration)
    .values({ ...seed, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  await seedStudents(deps);
}

/**
 * The `h.seed.institutionRegistration()` builder: registers an
 * institution for a competition as seed data, with no checks, no message
 * and no audit entry. `registeredBy` defaults to nobody.
 */
export function institutionRegistrationBuilder(deps: SeedDeps) {
  return async (options: {
    institutionId: string;
    competitionId: string;
    registeredBy?: string;
  }): Promise<{ id: string; reference: string }> => {
    const [target] = await deps.db
      .select({ code: competition.code })
      .from(competition)
      .where(eq(competition.id, options.competitionId));
    if (!target) {
      throw new Error(`No competition ${options.competitionId}`);
    }
    const now = deps.clock.now();
    const id = uuidv7(now);
    const reference = await withUniqueCode(
      {
        format: { prefix: `${target.code}-I-`, length: REFERENCE_SYMBOL_COUNT },
        constraint: INSTITUTION_REGISTRATION_REFERENCE_UNIQUE,
      },
      // A savepoint per try, so a taken reference can't abort a caller's
      // transaction.
      (code) =>
        deps.db.transaction(async (tx) => {
          await tx.insert(institutionRegistration).values({
            id,
            institutionId: options.institutionId,
            competitionId: options.competitionId,
            reference: code,
            registeredBy: options.registeredBy ?? null,
            createdAt: now,
            updatedAt: now,
          });
          return code;
        })
    );
    return { id, reference };
  };
}
