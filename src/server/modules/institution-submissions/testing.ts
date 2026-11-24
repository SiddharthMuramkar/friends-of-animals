// Shared set-up for #87's Seam 1 tests: a verified school registered for a
// free competition with students its coordinator enrolled and confirmed,
// and a second school with its own coordinator. Test code only; nothing in
// the app imports it.

import type { Actor } from "@/server/actor";
import {
  enrol,
  schoolWithStudents,
  setInstitutionFee,
} from "@/server/modules/payments/testing";
import {
  registeredSchool,
  STUDENT_AGE_GROUPS,
} from "@/server/modules/registration/testing";
import type { SeedCompetitionOptions } from "@/server/seed/competitions";
import type { Harness } from "@/test/harness";

export type ConfirmedSchool = Awaited<ReturnType<typeof confirmedSchool>>;

/**
 * A school (PAWS27, or `code`) whose coordinator enrolled `students`
 * children (each with a guardian whose email is `guardian-<n>@example.test`)
 * and confirmed them for free. With `unconfirmed`, that many more are
 * enrolled after the payment and stay `enrolled`.
 */
export async function confirmedSchool(
  h: Harness,
  {
    students = 2,
    unconfirmed = 0,
    code,
    name,
  }: {
    students?: number;
    unconfirmed?: number;
    code?: string;
    name?: string;
  } = {}
) {
  const school = await schoolWithStudents(h, {
    students,
    feePaise: 0n,
    ...(code ? { code } : {}),
    ...(name ? { name } : {}),
  });
  if (students > 0) {
    const paid = await school.pay();
    if (!paid.ok) throw new Error(`Could not confirm: ${JSON.stringify(paid)}`);
  }
  const unconfirmedIds: string[] = [];
  for (let n = 1; n <= unconfirmed; n++) {
    unconfirmedIds.push(await enrol(h, school, students + n));
  }
  // The confirmations' messages go now, so a test sees only its own.
  await h.drain();
  return {
    ...school,
    unconfirmedIds,
    /** The coordinator acting on the `n`th confirmed student (from 1). */
    forStudent: (
      n: number,
      actor: Actor = school.coordinator.actor
    ): { actor: Actor; registrationId: string } => ({
      actor,
      registrationId: school.registrationIds[n - 1]!,
    }),
  };
}

/** A second verified school, registered for `competition`, with its coordinator. */
export async function otherSchool(
  h: Harness,
  competition: SeedCompetitionOptions = { code: "SKIES27" }
) {
  return registeredSchool(h, { name: "Other School", competition });
}

/** The adult student's own email, where their receipt goes. */
export const ADULT_STUDENT_EMAIL = "meera.iyer@example.test";

/**
 * A college registered for a free competition with an adult age group, and
 * one adult student, Meera Iyer, enrolled with her own email and confirmed.
 */
export async function schoolWithAdultStudent(h: Harness) {
  const school = await registeredSchool(h, {
    name: "Test College",
    competition: {
      code: "ADULT27",
      ageGroups: [
        ...STUDENT_AGE_GROUPS,
        { label: "Adults", minAge: 18, maxAge: 99 },
      ],
    },
  });
  await setInstitutionFee(h, school, 0n);
  const enrolled = await h.as(school.coordinator.actor).enrolStudent({
    institutionId: school.institutionId,
    reference: school.reference,
    student: {
      fullName: "Meera Iyer",
      dateOfBirth: "2005-03-14",
      grade: "BA year 2",
      phone: "90000 00401",
      email: ADULT_STUDENT_EMAIL,
    },
  });
  if (!enrolled.ok) throw new Error(`Could not enrol: ${enrolled.error}`);
  const paid = await h.as(school.coordinator.actor).payInstitutionFees({
    institutionId: school.institutionId,
    reference: school.reference,
  });
  if (!paid.ok) throw new Error(`Could not confirm: ${JSON.stringify(paid)}`);
  await h.drain();
  return { ...school, studentRegistrationId: enrolled.registrationId };
}
