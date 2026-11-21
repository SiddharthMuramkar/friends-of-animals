// One CSV writer for every export (the accountant's ledger export, reports).
// RFC 4180 with CRLF line ends and a UTF-8 byte order mark, so Excel opens
// Indian-language text correctly.
//
// Spreadsheet apps run a cell that starts with `=`, `+`, `-`, `@`, a tab or
// a carriage return as a formula, so such text cells get a leading `'` and
// are read as text (CSV injection). Amounts must stay numeric, so they are
// passed as numbers, bigints or `decimalCell`s, which are never prefixed:
// a negative amount stays a number.
//
// Callers decide what goes in. Never pass personal data the viewer may not
// see. Pure; no imports.

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** A number already formatted as a plain decimal, e.g. "-1250.50". */
export type DecimalCell = { readonly kind: "decimal"; readonly value: string };

/** Marks a preformatted decimal as a numeric cell. */
export function decimalCell(value: string): DecimalCell {
  if (!DECIMAL.test(value)) {
    throw new RangeError(`Not a plain decimal: ${JSON.stringify(value)}`);
  }
  return { kind: "decimal", value };
}

export type CsvCell = string | number | bigint | DecimalCell | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

function textCell(text: string): string {
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return textCell(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Not a finite number: ${value}`);
    }
    return String(value);
  }
  return value.value;
}

/** The rows as one CSV document. */
export function toCsv(
  rows: readonly (readonly CsvCell[])[],
  options: { bom?: boolean } = {}
): string {
  const body = rows.map((row) => `${row.map(cell).join(",")}\r\n`).join("");
  return (options.bom ?? true) ? `﻿${body}` : body;
}
