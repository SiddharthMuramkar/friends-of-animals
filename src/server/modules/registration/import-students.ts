// importStudents({ institutionId, reference, file }) (#76): a coordinator,
// or the authorised person, of an institution registered for a
// competition enrols many students at once from a CSV file while
// registration is open. Every row is held to the rules of adding one
// student (#75's prepareStudent, its duplicate rule and its insert, in
// ./enrolment.ts); good rows are enrolled, and every other row comes back
// with its cells and why, for a report the coordinator fixes and uploads
// again.
//
// Nothing is stored but the enrolments: the file and the report live only
// in the request. Each row's profile, registration and audit entry commit
// together or not at all (a savepoint per row), and one counts entry
// records the import, in the same transaction.

import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { isUniqueViolation } from "../codes/codes";
import { institutionResource } from "../institutions/coordinators/policy";
import { indianDateAt } from "./domain/calendar-date";
import type { EnrolmentState } from "./domain/enrolment-state";
import { prepareStudent } from "./domain/prepare-student";
import { readStudentCsv, type StudentCsvProblem } from "./domain/student-csv";
import {
  importOutcome,
  type NotEnrolledRow,
  prepareImportRows,
} from "./domain/student-import";
import {
  enrolPlannedRows,
  planStudentImport,
  type StudentImportCounts,
} from "./domain/student-import-plan";
import {
  findEnrolledKeys,
  insertEnrolment,
  ONE_LIVE_REGISTRATION,
} from "./enrolment";
import { ageGroupsOf, loadEnrolmentFacts } from "./enrolment-facts";
import { normaliseStudentPhone } from "./student-profile";

export type ImportStudentsInput = {
  institutionId: string;
  /** The institution registration's reference, e.g. PAWS27-I-Q2W9R. */
  reference: string;
  /** The uploaded file's bytes. */
  file: Uint8Array;
};

export type ImportStudentsResult =
  | {
      ok: true;
      counts: StudentImportCounts;
      /** The uploaded header row, for the report. */
      header: string[];
      /** Columns the template doesn't have, as uploaded; not read. */
      ignoredColumns: string[];
      /** In file order. */
      notEnrolled: NotEnrolledRow[];
    }
  | InvalidInput
  | { ok: false; error: "unreadable_file"; problem: StudentCsvProblem }
  | { ok: false; error: "not_found" | Exclude<EnrolmentState, "open"> };

const importInput = z.object({
  institutionId: z.uuid(),
  reference: z.string().max(40),
  file: z.instanceof(Uint8Array),
});

export async function importStudents(
  ctx: UseCaseContext,
  input: ImportStudentsInput
): Promise<ImportStudentsResult> {
  const parsed = importInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, reference, file } = parsed.data;
  const resource = institutionResource(institutionId);
  await authorize(ctx, "institution.coordinate", resource);

  const read = readStudentCsv(file);
  if (!read.ok) {
    return { ok: false, error: "unreadable_file", problem: read.problem };
  }
  const { rows, header, ignoredColumns } = read.file;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    // Locked: an enrolment by hand meanwhile waits, so the duplicate check
    // below sees every student enrolled before the import.
    const facts = await loadEnrolmentFacts(
      tx,
      { institutionId, reference },
      now,
      { lock: true }
    );
    // Again inside the transaction: a role revoked since the first check
    // counts.
    const { role: actorRole } = await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "institution.coordinate",
      resource
    );
    if (!facts) return { ok: false, error: "not_found" } as const;
    if (facts.enrolment !== "open") {
      return { ok: false, error: facts.enrolment } as const;
    }
    const { competitionId, id: institutionRegistrationId } =
      facts.institutionRegistration;

    const context = {
      ageCutoffDate: facts.competition.ageCutoffDate,
      ageGroups: await ageGroupsOf(tx, competitionId),
      today: indianDateAt(now),
      institutionDefaults: facts.institution,
    };
    const prepared = prepareImportRows(rows, (student) =>
      prepareStudent(context, student, {
        normalisePhone: normaliseStudentPhone,
        blindIndex: ctx.blindIndex,
      })
    );
    const enrolledKeys = await findEnrolledKeys(
      tx,
      institutionRegistrationId,
      prepared.flatMap((row) => (row.ok ? [row.value] : []))
    );
    const plan = planStudentImport(prepared, enrolledKeys);
    const target = {
      institutionId,
      institutionRegistrationId,
      competitionId,
      actorRole,
    };
    const tried = await enrolPlannedRows(
      plan.toEnrol,
      // A savepoint per row: a row that fails leaves nothing behind.
      (student) =>
        tx.transaction((row) => insertEnrolment(row, ctx, target, student)),
      (error) => isUniqueViolation(error, ONE_LIVE_REGISTRATION)
    );
    const { counts, notEnrolled } = importOutcome(rows, plan.skipped, tried);

    await recordAudit(tx, ctx, {
      action: "registration.students_imported",
      entity: {
        type: "institution_registration",
        id: institutionRegistrationId,
      },
      before: null,
      // Counts only: no names, no personal data.
      after: { institutionRegistrationId, ...counts },
      actorRole,
    });
    return { ok: true, counts, header, ignoredColumns, notEnrolled } as const;
  });
}
