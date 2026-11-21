// The student import (#76) between reading the file and enrolling: each
// row checked by the single-student rules (#75), keyed so the same student
// is recognised twice, and what to report for every row that wasn't
// enrolled.
//
// Pure. Loads under plain Node.

import type { AgeGroup } from "./age-group";
import type { StudentCsvRow } from "./student-csv";
import type {
  StudentField,
  StudentFieldError,
  StudentInput,
} from "./student-details";
import type { PreparedImportRow } from "./student-import-plan";

/** What #75 reports about one student it can't enrol. */
export type StudentProblem =
  | { field: StudentField; code: StudentFieldError }
  | {
      field: "dateOfBirth";
      code: "outside_age_groups";
      age: number;
      /** Youngest first. */
      groups: AgeGroup[];
    }
  | { code: "overlapping_age_groups" | "no_age_groups" };

/** #75's check of one student: ready to enrol, or why not. */
export type PrepareStudentResult<S> =
  | { ok: true; student: S }
  | { ok: false; problems: StudentProblem[] };

/** How a student is recognised: what every prepared student carries. */
export type StudentIdentity = {
  /** The keyed hash of the normalised name and date of birth. */
  identityHash: string;
  /** The institution's roll number, as #75 stores it, or null. */
  studentRef: string | null;
};

/** Why a row wasn't enrolled. */
export type StudentImportProblem =
  | StudentProblem
  /** Filled cells beyond the last column: the row has shifted. */
  | { code: "extra_cells" };

/**
 * The keys a student is recognised by, each prefixed with its kind so they
 * never collide: the roll number first, since a school's own number is the
 * surest match, then the identity.
 */
function matchKeys({ identityHash, studentRef }: StudentIdentity): string[] {
  return [...(studentRef === null ? [] : [`ref:${studentRef}`]), `id:${identityHash}`];
}

/**
 * Checks every row with `prepare` (#75's rules for one student) and keys
 * the valid ones, so the plan can find a student twice.
 */
export function prepareImportRows<S extends StudentIdentity>(
  rows: readonly StudentCsvRow[],
  prepare: (input: StudentInput) => PrepareStudentResult<S>
): PreparedImportRow<S, StudentImportProblem>[] {
  return rows.map((row) => {
    const prepared = prepare(row.input);
    // A shifted row's cells may sit under the wrong headers and still pass,
    // so it is never enrolled; its other problems are listed too.
    const problems: StudentImportProblem[] = [
      ...(row.extraCells ? [{ code: "extra_cells" as const }] : []),
      ...(prepared.ok ? [] : prepared.problems),
    ];
    if (!prepared.ok || problems.length > 0) {
      return { ok: false, rowNumber: row.rowNumber, problems };
    }
    return {
      ok: true,
      rowNumber: row.rowNumber,
      value: prepared.student,
      keys: matchKeys(prepared.student),
    };
  });
}
