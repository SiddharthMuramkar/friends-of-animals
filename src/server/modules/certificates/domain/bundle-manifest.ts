// The list inside a certificate bundle. PDFs in the ZIP are named by
// certificate number only, so the coordinator needs this sheet to see
// whose certificate is whose. The caller supplies the header in the user's
// language and one row per PDF.
//
// The CSV follows RFC 4180 (CRLF lines, quotes doubled) and starts with a
// byte-order mark so spreadsheet apps read Devanagari and other scripts as
// UTF-8. Cells that a spreadsheet would run as a formula get a leading
// apostrophe (OWASP "CSV injection"): a name or award is text, never code.
//
// Pure. Loads under plain Node.

/** The sheet's name inside the ZIP. */
export const MANIFEST_FILE_NAME = "certificates.csv";

const BYTE_ORDER_MARK = "﻿";

// = + - @ start a formula in Excel, LibreOffice and Google Sheets; a
// leading tab or carriage return can hide one.
const FORMULA_START = /^[=+\-@\t\r]/;

const NEEDS_QUOTES = /[",\r\n]/;

function cell(value: string): string {
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The manifest's text: header first, then one line per row. */
export function bundleManifestCsv(
  header: readonly string[],
  rows: readonly (readonly string[])[]
): string {
  rows.forEach((row, index) => {
    if (row.length !== header.length) {
      throw new RangeError(
        `Row ${index + 1} has ${row.length} cells; the header has ${header.length}`
      );
    }
  });
  const lines = [header, ...rows].map(
    (row) => `${row.map(cell).join(",")}\r\n`
  );
  return `${BYTE_ORDER_MARK}${lines.join("")}`;
}
