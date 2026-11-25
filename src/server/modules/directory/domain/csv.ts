// A small CSV reader (RFC 4180) for the pin-code import (#128): commas,
// double-quoted fields with "" for a quote, CRLF or LF line ends, and a
// byte-order mark, which data.gov.in's downloads start with. Enough for
// India Post's file; not a general-purpose parser.
//
// Loads under plain Node: no "server-only", no `@/` imports.

/** Every record in `text`, each as its fields. */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
    started = false;
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    started = true;
    if (char === '"') quoted = true;
    else if (char === ",") endField();
    else if (char === "\n") endRecord();
    else if (char === "\r" && source[i + 1] === "\n") {
      endRecord();
      i += 1;
    } else field += char;
  }
  if (started || field !== "" || record.length > 0) endRecord();
  return records;
}
