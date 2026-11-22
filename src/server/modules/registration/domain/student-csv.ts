// The student import file (#76): its columns, the blank template, reading
// an upload into one set of raw student details per row, and the error
// report a coordinator downloads, fixes and uploads again.
//
// A row's cells come out raw, keyed by the same names as the single-student
// form (#75's StudentInput), so both are checked by #75's
// parseStudentDetails and report the same per-field errors. Nothing here
// decides whether a row is valid; it only decides whether the file can be
// read at all.
//
// Pure. Loads under plain Node.

import { formatCsv, neutraliseFormula, parseCsv, restoreFormula } from "./csv";
import type { StudentField } from "./student-details";

/** The student details a column fills: #75's StudentInput keys. */
export type StudentCsvField = StudentField;

/**
 * When a column must be filled in: always, for a student under 18, for an
 * adult student, or never. The page explains the template with it; the
 * rules themselves live in parseStudentDetails.
 */
export type ColumnNeed = "always" | "minor" | "adult" | "optional";

export type StudentCsvColumn = {
  header: string;
  field: StudentCsvField;
  need: ColumnNeed;
};

/** The template's columns, in its order. */
export const STUDENT_CSV_COLUMNS: readonly StudentCsvColumn[] = [
  { header: "student_ref", field: "studentRef", need: "optional" },
  { header: "full_name", field: "fullName", need: "always" },
  { header: "date_of_birth", field: "dateOfBirth", need: "always" },
  { header: "grade", field: "grade", need: "optional" },
  { header: "guardian_name", field: "guardianName", need: "minor" },
  {
    header: "guardian_relationship",
    field: "guardianRelationship",
    need: "minor",
  },
  { header: "guardian_phone", field: "guardianPhone", need: "minor" },
  { header: "guardian_email", field: "guardianEmail", need: "optional" },
  { header: "student_phone", field: "phone", need: "adult" },
  { header: "student_email", field: "email", need: "optional" },
  { header: "address", field: "address", need: "optional" },
  { header: "pin_code", field: "pinCode", need: "optional" },
  { header: "city", field: "city", need: "optional" },
  { header: "state", field: "state", need: "optional" },
];

/** Without these a file can't be read as students at all. */
const REQUIRED_HEADERS = ["full_name", "date_of_birth"] as const;

/** Columns the error report adds; ignored when it comes back fixed. */
const ROW_NUMBER = "row_number";
const PROBLEMS = "problems";
const REPORT_HEADERS: ReadonlySet<string> = new Set([ROW_NUMBER, PROBLEMS]);

export type StudentImportLimits = { maxRows: number; maxBytes: number };

/**
 * 1,000 rows, as the brief's prior art set. 750 KiB rather than its 2 MB:
 * the file arrives through a Server Action, which Next caps at 1 MB
 * including the form's other fields, and a full 1,000-row file of long
 * addresses is still well under 300 KB.
 */
export const STUDENT_IMPORT_LIMITS: StudentImportLimits = {
  maxRows: 1000,
  maxBytes: 750 * 1024,
};

export type StudentCsvInput = Partial<Record<StudentCsvField, string>>;

export type StudentCsvRow = {
  /** As a spreadsheet numbers it: the header is row 1. */
  rowNumber: number;
  /** One cell per header column, as uploaded (blank when the row was short). */
  cells: string[];
  /** The cells of the known columns, raw. */
  input: StudentCsvInput;
  /** The row has filled cells beyond the last column: a shifted row. */
  extraCells: boolean;
};

export type StudentCsvFile = {
  /** The header row as uploaded. */
  header: string[];
  /** Columns that aren't ours, as uploaded, left out of every row's input. */
  ignoredColumns: string[];
  /** Every row that isn't blank, in file order. */
  rows: StudentCsvRow[];
};

export type StudentCsvProblem =
  | { code: "empty" }
  | { code: "too_large"; maxBytes: number }
  | { code: "not_utf8" }
  | { code: "wrong_separator"; separator: ";" | "\t" }
  | {
      code: "malformed";
      reason: "unterminated_quote" | "text_after_quote";
      line: number;
    }
  | { code: "missing_columns"; columns: string[] }
  | { code: "duplicate_columns"; columns: string[] }
  | { code: "no_rows" }
  | { code: "too_many_rows"; maxRows: number; rows: number };

export type StudentCsvResult =
  | { ok: true; file: StudentCsvFile }
  | { ok: false; problem: StudentCsvProblem };

/** "Date of Birth", " date-of-birth " and "DATE_OF_BIRTH" all match. */
export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

const isBlank = (cell: string) => cell.trim() === "";

/** Reads an uploaded file, or says why it can't be read. */
export function readStudentCsv(
  bytes: Uint8Array,
  limits: StudentImportLimits = STUDENT_IMPORT_LIMITS
): StudentCsvResult {
  const refuse = (problem: StudentCsvProblem): StudentCsvResult => ({
    ok: false,
    problem,
  });

  if (bytes.length > limits.maxBytes) {
    return refuse({ code: "too_large", maxBytes: limits.maxBytes });
  }
  let text: string;
  try {
    // Strips a byte order mark, and throws on bytes that aren't UTF-8.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return refuse({ code: "not_utf8" });
  }
  if (text.trim() === "") return refuse({ code: "empty" });

  const parsed = parseCsv(text);
  if (!parsed.ok) {
    return refuse({
      code: "malformed",
      reason: parsed.reason,
      line: parsed.line,
    });
  }
  const [header = [], ...records] = parsed.records;

  if (header.length === 1) {
    const only = header[0] ?? "";
    if (only.includes(";")) {
      return refuse({ code: "wrong_separator", separator: ";" });
    }
    if (only.includes("\t")) {
      return refuse({ code: "wrong_separator", separator: "\t" });
    }
  }

  const names = header.map(normaliseHeader);
  const columns = new Map<number, StudentCsvColumn>();
  const ignoredColumns: string[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  names.forEach((name, index) => {
    const column = STUDENT_CSV_COLUMNS.find((known) => known.header === name);
    if (column) {
      if (seen.has(name)) duplicates.add(name);
      seen.add(name);
      columns.set(index, column);
    } else if (!REPORT_HEADERS.has(name)) {
      ignoredColumns.push(header[index] ?? "");
    }
  });

  if (duplicates.size > 0) {
    return refuse({
      code: "duplicate_columns",
      columns: STUDENT_CSV_COLUMNS.map((column) => column.header).filter(
        (name) => duplicates.has(name)
      ),
    });
  }
  const missing = REQUIRED_HEADERS.filter((name) => !seen.has(name));
  if (missing.length > 0) {
    return refuse({ code: "missing_columns", columns: [...missing] });
  }

  const rows: StudentCsvRow[] = [];
  records.forEach((record, index) => {
    if (record.every(isBlank)) return;
    const cells = header.map((_, column) =>
      restoreFormula(record[column] ?? "")
    );
    const input: StudentCsvInput = {};
    for (const [column, { field }] of columns) input[field] = cells[column];
    rows.push({
      rowNumber: index + 2,
      cells,
      input,
      extraCells: record.slice(header.length).some((cell) => !isBlank(cell)),
    });
  });

  if (rows.length === 0) return refuse({ code: "no_rows" });
  if (rows.length > limits.maxRows) {
    return refuse({
      code: "too_many_rows",
      maxRows: limits.maxRows,
      rows: rows.length,
    });
  }
  return { ok: true, file: { header, ignoredColumns, rows } };
}

const BOM = "﻿";

/**
 * The blank template: the header row alone. The byte order mark makes
 * Excel open it as UTF-8, so names in any script survive a round trip.
 */
export function studentCsvTemplate(): string {
  return BOM + formatCsv([STUDENT_CSV_COLUMNS.map((column) => column.header)]);
}

export type StudentImportReportRow = {
  rowNumber: number;
  /** The row's cells as uploaded, one per header column. */
  cells: readonly string[];
  /** Already worded for the coordinator. */
  problems: readonly string[];
};

/**
 * The rows that weren't enrolled, as uploaded, each followed by its row
 * number and its problems, so the coordinator can fix them and upload the
 * file again: the two added columns are ignored on the way back in. Every
 * cell is neutralised, since they are what someone typed.
 */
export function formatStudentImportReport(
  header: readonly string[],
  rows: readonly StudentImportReportRow[]
): string {
  const kept = header
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => !REPORT_HEADERS.has(normaliseHeader(name)));
  const records = [
    [...kept.map(({ name }) => name), ROW_NUMBER, PROBLEMS],
    ...[...rows]
      .sort((a, b) => a.rowNumber - b.rowNumber)
      .map((row) => [
        ...kept.map(({ index }) => row.cells[index] ?? ""),
        String(row.rowNumber),
        row.problems.join("; "),
      ]),
  ];
  return (
    BOM + formatCsv(records.map((record) => record.map(neutraliseFormula)))
  );
}
