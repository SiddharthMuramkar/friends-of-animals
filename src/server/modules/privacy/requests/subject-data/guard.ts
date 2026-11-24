// The last check before a row goes into someone's data export (#115b):
// every row must name one of the person's accounts or profiles, or a row
// an earlier section of the same export holds (their entry, their
// payment). A row that names neither is someone else's: the export fails
// closed and nothing is stored, rather than leak it.
//
// Pure, and loads under plain Node.

/** Thrown for a row that isn't the subject's. Names ids only. */
export class ForeignRowError extends Error {
  constructor(section: string, rowId: string) {
    super(`The ${section} row ${rowId} isn't the subject's: export refused`);
    this.name = "ForeignRowError";
  }
}

export function assertRowsBelongToSubject(
  section: string,
  rows: readonly Readonly<Record<string, unknown>>[],
  owners: readonly string[],
  allowed: ReadonlySet<string>
): void {
  for (const row of rows) {
    const owned = owners.some((owner) => {
      const value = row[owner];
      return typeof value === "string" && allowed.has(value);
    });
    if (!owned) {
      const id = row.id;
      throw new ForeignRowError(section, typeof id === "string" ? id : "?");
    }
  }
}
