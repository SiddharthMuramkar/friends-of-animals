// listEnrolledStudents({ institutionId, reference }) (#75): the
// coordinator dashboard of one institution registration. Its students by
// name, each with grade, age group and status, counts by status, and
// whether more can be added now. Names and grades only: no date of birth
// and no contact details, which stay encrypted and unread here.

import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import {
  competitionAgeGroup,
  participantProfile,
  registration,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { institutionResource } from "../institutions/coordinators/policy";
import type { EnrolmentState } from "./domain/enrolment-state";
import {
  REGISTRATION_STATUSES,
  type RegistrationStatus,
} from "./domain/registration-status";
import { ageGroupsOf, loadEnrolmentFacts } from "./enrolment-facts";

export type EnrolledStudent = {
  registrationId: string;
  fullName: string;
  grade: string | null;
  ageGroupLabel: string;
  status: RegistrationStatus;
};

export type ListEnrolledStudentsResult =
  | {
      ok: true;
      institution: { id: string; name: string };
      competition: {
        code: string;
        name: string;
        /** `YYYY-MM-DD`: ages are counted on this day. */
        ageCutoffDate: string;
        /** In the order the competition lists them. */
        ageGroups: { label: string; minAge: number; maxAge: number }[];
      };
      reference: string;
      /** Whether students can be added or withdrawn now, or why not. */
      enrolment: EnrolmentState;
      counts: Record<RegistrationStatus, number>;
      /** By name, ignoring case and accents. */
      students: EnrolledStudent[];
    }
  | InvalidInput
  | { ok: false; error: "not_found" };

const listInput = z.object({
  institutionId: z.uuid(),
  reference: z.string().max(40),
});

const byName = new Intl.Collator("en-IN", { sensitivity: "base" });

export async function listEnrolledStudents(
  ctx: UseCaseContext,
  input: { institutionId: string; reference: string }
): Promise<ListEnrolledStudentsResult> {
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, reference } = parsed.data;
  await authorize(
    ctx,
    "institution.coordinate",
    institutionResource(institutionId)
  );

  const facts = await loadEnrolmentFacts(
    ctx.db,
    { institutionId, reference },
    ctx.clock.now(),
    { lock: false }
  );
  if (!facts) return { ok: false, error: "not_found" };
  const { id: institutionRegistrationId, competitionId } =
    facts.institutionRegistration;

  const rows = await ctx.db
    .select({
      registrationId: registration.id,
      fullName: participantProfile.fullName,
      grade: participantProfile.grade,
      ageGroupLabel: competitionAgeGroup.label,
      status: registration.status,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .innerJoin(
      competitionAgeGroup,
      eq(competitionAgeGroup.id, registration.ageGroupId)
    )
    .where(
      eq(registration.institutionRegistrationId, institutionRegistrationId)
    )
    .orderBy(asc(registration.id));
  const students = rows.toSorted((a, b) =>
    byName.compare(a.fullName, b.fullName)
  );
  const counts = Object.fromEntries(
    REGISTRATION_STATUSES.map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ])
  ) as Record<RegistrationStatus, number>;
  const ageGroups = (await ageGroupsOf(ctx.db, competitionId)).map(
    ({ label, minAge, maxAge }) => ({ label, minAge, maxAge })
  );

  return {
    ok: true,
    institution: { id: institutionId, name: facts.institution.name },
    competition: { ...facts.competition, ageGroups },
    reference: facts.institutionRegistration.reference,
    enrolment: facts.enrolment,
    counts,
    students,
  };
}
