// What the import page says after an upload (#76), from importStudents'
// result: a summary, each row not enrolled with its problems worded by
// column, and the report of rows to fix as a CSV file. Pure: the action
// passes the translator, so the wording is tested without a page, and the
// client island gets finished words and ships no message catalogue.

import {
  formatStudentImportReport,
  normaliseHeader,
  STUDENT_CSV_COLUMNS,
  type StudentCsvField,
} from "@/server/modules/registration/domain/student-csv";
import type {
  ImportStudentsResult,
  StudentCsvProblem,
  StudentImportProblem,
} from "@/server/modules/registration";

/** What the island shows next. Its starting state is `{ step: "idle" }`. */
export type ImportView =
  | { step: "idle" }
  /** Nothing was read or written; `alert` says why. */
  | { step: "refused"; alert: string }
  | {
      step: "done";
      /** Success when every row was enrolled. */
      tone: "success" | "danger";
      summary: string;
      /** The columns that weren't read, when there were any. */
      ignored?: string;
      /** Each row not enrolled, in file order. */
      rows: { rowNumber: number; name: string; problems: string[] }[];
      /** Those rows as a CSV file to fix and upload again. */
      report?: string;
    };

/** Message keys are under `studentImport`. */
export type ImportWords = {
  t: (key: string, values?: Record<string, string | number>) => string;
  /** A `YYYY-MM-DD` date as the page writes dates. */
  formatDate: (isoDate: string) => string;
};

/**
 * What the use case gave the action: its result, "forbidden" when it
 * refused the actor, or `undefined` when it failed otherwise.
 */
export type ImportAttempt = ImportStudentsResult | "forbidden" | undefined;

/** The fields a student can't go without, each with its own message. */
const REQUIRED_FIELDS: readonly StudentCsvField[] = [
  "fullName",
  "dateOfBirth",
  "guardianName",
  "guardianRelationship",
  "guardianPhone",
  "phone",
];

const columnFor = (field: StudentCsvField): string =>
  STUDENT_CSV_COLUMNS.find((column) => column.field === field)?.header ?? field;

function problemText(
  problem: StudentImportProblem,
  { t, formatDate }: ImportWords
): string {
  if (!("field" in problem)) {
    switch (problem.code) {
      case "duplicate_in_file":
        return t("problems.duplicate_in_file", { row: problem.duplicateOf });
      case "overlapping_age_groups":
      case "no_age_groups":
        return t("problems.age_groups_need_fixing");
      default:
        return t(`problems.${problem.code}`);
    }
  }
  if (problem.code === "outside_age_groups") {
    return t("problems.outside_age_groups", {
      minAge: Math.min(...problem.groups.map((group) => group.minAge)),
      maxAge: Math.max(...problem.groups.map((group) => group.maxAge)),
      age: problem.age,
      cutoff: formatDate(problem.ageCutoffDate),
    });
  }
  if (problem.code === "required") {
    return REQUIRED_FIELDS.includes(problem.field)
      ? t(`problems.required.${problem.field}`)
      : t("problems.missing", { column: columnFor(problem.field) });
  }
  return t(`problems.${problem.code}`, { column: columnFor(problem.field) });
}

function fileProblemText(
  problem: StudentCsvProblem,
  { t }: ImportWords
): string {
  switch (problem.code) {
    case "too_large":
      return t("file.too_large", {
        maxKb: Math.floor(problem.maxBytes / 1024),
      });
    case "wrong_separator":
      return t("file.wrong_separator", {
        separator: problem.separator === ";" ? "semicolon" : "tab",
      });
    case "malformed":
      return t("file.malformed", { line: problem.line });
    case "missing_columns":
    case "duplicate_columns":
      return t(`file.${problem.code}`, {
        columns: problem.columns.join(", "),
      });
    case "too_many_rows":
      return t("file.too_many_rows", {
        rows: problem.rows,
        maxRows: problem.maxRows,
      });
    default:
      return t(`file.${problem.code}`);
  }
}

export function importView(
  result: ImportAttempt,
  words: ImportWords
): ImportView {
  const { t } = words;
  const refused = (alert: string): ImportView => ({ step: "refused", alert });
  if (result === "forbidden") return refused(t("alert.forbidden"));
  if (!result) return refused(t("alert.failed"));
  if (!result.ok) {
    switch (result.error) {
      case "unreadable_file":
        return refused(fileProblemText(result.problem, words));
      // The page's own form sends the ids: bad input means the
      // registration it named isn't there.
      case "invalid_input":
        return refused(t("alert.not_found"));
      default:
        return refused(t(`alert.${result.error}`));
    }
  }

  const { counts, header, ignoredColumns, notEnrolled } = result;
  const nameAt = header.findIndex(
    (name) => normaliseHeader(name) === "full_name"
  );
  const rows = notEnrolled.map((row) => ({
    rowNumber: row.rowNumber,
    name: row.cells[nameAt]?.trim() || t("noName"),
    problems: row.problems.map((problem) => problemText(problem, words)),
  }));
  const summary =
    counts.notEnrolled === 0
      ? t("summary.all", { enrolled: counts.enrolled })
      : counts.enrolled === 0
        ? t("summary.none", { notEnrolled: counts.notEnrolled })
        : t("summary.some", {
            enrolled: counts.enrolled,
            notEnrolled: counts.notEnrolled,
          });
  return {
    step: "done",
    tone: counts.notEnrolled === 0 ? "success" : "danger",
    summary,
    ...(ignoredColumns.length > 0
      ? { ignored: t("ignored", { columns: ignoredColumns.join(", ") }) }
      : {}),
    rows,
    ...(rows.length > 0
      ? {
          report: formatStudentImportReport(
            header,
            notEnrolled.map((row, index) => ({
              rowNumber: row.rowNumber,
              cells: row.cells,
              problems: rows[index]!.problems,
            }))
          ),
        }
      : {}),
  };
}
