// describeStudentImport({ institutionId, reference }) (#76): what the
// import page and its template download need about one institution
// registration: the template's columns and when each must be filled in,
// the file limits, the competition's ages, and whether students can be
// imported now. Who may see it is who may import.

import { z } from "zod";

import { authorize } from "../../access/can";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { institutionResource } from "../institutions/coordinators/policy";
import type { EnrolmentState } from "./domain/enrolment-state";
import {
  type ColumnNeed,
  STUDENT_CSV_COLUMNS,
  STUDENT_IMPORT_LIMITS,
  type StudentImportLimits,
} from "./domain/student-csv";
import { ageGroupsOf, loadEnrolmentFacts } from "./enrolment-facts";

export type DescribeStudentImportResult =
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
      /** Whether students can be imported now, or why not. */
      enrolment: EnrolmentState;
      /** The template's columns, in its order. */
      columns: { header: string; need: ColumnNeed }[];
      limits: StudentImportLimits;
    }
  | InvalidInput
  | { ok: false; error: "not_found" };

const describeInput = z.object({
  institutionId: z.uuid(),
  reference: z.string().max(40),
});

export async function describeStudentImport(
  ctx: UseCaseContext,
  input: { institutionId: string; reference: string }
): Promise<DescribeStudentImportResult> {
  const parsed = describeInput.safeParse(input);
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
  const ageGroups = (
    await ageGroupsOf(ctx.db, facts.institutionRegistration.competitionId)
  ).map(({ label, minAge, maxAge }) => ({ label, minAge, maxAge }));

  return {
    ok: true,
    institution: { id: institutionId, name: facts.institution.name },
    competition: { ...facts.competition, ageGroups },
    reference: facts.institutionRegistration.reference,
    enrolment: facts.enrolment,
    columns: STUDENT_CSV_COLUMNS.map(({ header, need }) => ({ header, need })),
    limits: STUDENT_IMPORT_LIMITS,
  };
}
