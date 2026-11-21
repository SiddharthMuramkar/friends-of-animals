// CSV as spreadsheets write it (RFC 4180), for the student import (#76):
// reading an uploaded file and writing the template and the error report.
// Lenient where spreadsheets differ (any line ending, a stray quote inside
// an unquoted field), strict where a file is broken (a quote that never
// closes, text after a closing quote), so a broken file is refused rather
// than read wrongly.
//
// Pure. Loads under plain Node.

export type CsvParseResult =
  | { ok: true; records: string[][] }
  | {
      ok: false;
      reason: "unterminated_quote" | "text_after_quote";
      /** The physical line, counting from 1, where the problem is. */
      line: number;
    };

const BOM = "﻿";

export function parseCsv(input: string): CsvParseResult {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let line = 1;
  let i = 0;

  const endRecord = () => {
    record.push(field);
    records.push(record);
    record = [];
    field = "";
  };
  /** Steps over a line ending at `i`, if there is one. */
  const lineEnding = (): boolean => {
    if (text[i] === "\r") {
      i += text[i + 1] === "\n" ? 2 : 1;
    } else if (text[i] === "\n") {
      i += 1;
    } else {
      return false;
    }
    line += 1;
    return true;
  };

  while (i < text.length) {
    if (text[i] === '"' && field === "") {
      const openedOn = line;
      i += 1;
      for (;;) {
        if (i >= text.length) {
          return { ok: false, reason: "unterminated_quote", line: openedOn };
        }
        const char = text[i]!;
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) {
          line += 1;
        }
        field += char;
        i += 1;
      }
      if (i >= text.length) {
        endRecord();
      } else if (text[i] === ",") {
        record.push(field);
        field = "";
        i += 1;
        if (i === text.length) endRecord();
      } else if (lineEnding()) {
        endRecord();
      } else {
        return { ok: false, reason: "text_after_quote", line };
      }
      continue;
    }

    if (text[i] === ",") {
      record.push(field);
      field = "";
      i += 1;
      if (i === text.length) endRecord();
      continue;
    }
    if (lineEnding()) {
      endRecord();
      continue;
    }
    field += text[i];
    i += 1;
    if (i === text.length) endRecord();
  }

  return { ok: true, records };
}

const NEEDS_QUOTES = /[",\r\n]/;

/** Records as CSV text: CRLF after every record, quotes only where needed. */
export function formatCsv(records: readonly (readonly string[])[]): string {
  return records
    .map(
      (record) =>
        record
          .map((field) =>
            NEEDS_QUOTES.test(field)
              ? `"${field.replaceAll('"', '""')}"`
              : field
          )
          .join(",") + "\r\n"
    )
    .join("");
}

// A spreadsheet runs a cell that starts with one of these as a formula
// (OWASP "CSV Injection"). Quotes already in front count too, so that
// restoreFormula can always undo exactly what neutraliseFormula did.
const FORMULA_START = /^'*[=+\-@\t\r]/;
const NEUTRALISED = /^'+[=+\-@\t\r]/;

/**
 * Makes a cell safe to open in a spreadsheet by putting a quote in front
 * of anything that would run as a formula. Used on every cell of a file
 * we hand back, since its cells are what someone typed.
 */
export function neutraliseFormula(cell: string): string {
  return FORMULA_START.test(cell) ? `'${cell}` : cell;
}

/**
 * Takes off the quote neutraliseFormula added, so a downloaded error
 * report, fixed and uploaded again, reads as the original values: a phone
 * written "'+91 98765 43210" is "+91 98765 43210" again.
 */
export function restoreFormula(cell: string): string {
  return NEUTRALISED.test(cell) ? cell.slice(1) : cell;
}
