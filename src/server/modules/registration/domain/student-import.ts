// The student import (#76) between reading the file and enrolling: each
// row checked by the single-student rules (#75's prepareStudent), keyed as
// enrolling keys a student (./identity-key.ts) so the same child is
// recognised twice, and, once the rows are enrolled, the counts and what
// to report for every row that wasn't.
//
// Pure. Loads under plain Node.

import { matchKeys } from "./identity-key";
import type {
  PreparedStudent,
  PrepareStudentResult,
  StudentProblem,
} from "./prepare-student";
import type { StudentCsvRow } from "./student-csv";
import type { StudentInput } from "./student-details";
import {
  type EnrolledRowOutcome,
  type PreparedImportRow,
  type SkippedImportRow,
  type StudentImportCounts,
  type StudentImportOutcomeKind,
  summariseStudentImport,
} from "./student-import-plan";

/** Why a row can't be enrolled, from the row alone. */
export type StudentRowProblem =
  | StudentProblem
  /** Filled cells beyond the last column: the row has shifted. */
  | { code: "extra_cells" };

/** Why a row wasn't enrolled. */
export type StudentImportProblem =
  | StudentRowProblem
  /** The same child as an earlier row, which was enrolled instead. */
  | { code: "duplicate_in_file"; duplicateOf: number }
  | { code: "already_enrolled" };

export type NotEnrolledRow = {
  /** As a spreadsheet numbers it: the header is row 1. */
  rowNumber: number;
  /** One per column of the uploaded header, as uploaded. */
  cells: string[];
  problems: StudentImportProblem[];
};

/**
 * Checks every row with `prepare` (#75's rules for one student) and keys
 * the valid ones, so the plan can find a student twice.
 */
export function prepareImportRows(
  rows: readonly StudentCsvRow[],
  prepare: (input: StudentInput) => PrepareStudentResult
): PreparedImportRow<PreparedStudent, StudentRowProblem>[] {
  return rows.map((row) => {
    const prepared = prepare(row.input);
    // A shifted row's cells may sit under the wrong headers and still pass,
    // so it is never enrolled; its other problems are listed too.
    const problems: StudentRowProblem[] = [
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

/**
 * What the import did, from the rows skipped by the plan and the outcome
 * of each row it tried: the counts, and each row not enrolled with its
 * cells and why, in file order.
 */
export function importOutcome(
  rows: readonly StudentCsvRow[],
  skipped: readonly SkippedImportRow<StudentRowProblem>[],
  tried: readonly EnrolledRowOutcome<unknown>[]
): { counts: StudentImportCounts; notEnrolled: NotEnrolledRow[] } {
  const problemsOf = new Map<number, StudentImportProblem[]>();
  for (const row of skipped) {
    problemsOf.set(
      row.rowNumber,
      row.kind === "invalid"
        ? row.problems
        : row.kind === "duplicate_in_file"
          ? [{ code: row.kind, duplicateOf: row.duplicateOf }]
          : [{ code: row.kind }]
    );
  }
  for (const row of tried) {
    if (row.kind === "already_enrolled") {
      problemsOf.set(row.rowNumber, [{ code: row.kind }]);
    }
  }
  const outcomes: { rowNumber: number; kind: StudentImportOutcomeKind }[] = [
    ...skipped,
    ...tried,
  ];
  return {
    counts: summariseStudentImport(outcomes),
    notEnrolled: rows.flatMap((row) => {
      const problems = problemsOf.get(row.rowNumber);
      return problems
        ? [{ rowNumber: row.rowNumber, cells: row.cells, problems }]
        : [];
    }),
  };
}
