// Which families to tell when a school round is decided. The first time,
// everyone. After a reopen, only the families whose outcome changed: a
// different outcome, or a different school position, because the message
// names the position. Families whose outcome is the same hear nothing new.
//
// Pure: no imports.

/** What a family was told, or is about to be told, about one registration. */
export type ToldOutcome = {
  outcome: "shortlisted" | "not_shortlisted";
  /** The school position; always null when not shortlisted. */
  position: number | null;
};

type Keyed = ToldOutcome & { registrationId: string };

function byRegistration(rows: readonly Keyed[]): Map<string, ToldOutcome> {
  const map = new Map<string, ToldOutcome>();
  for (const row of rows) {
    if (map.has(row.registrationId)) {
      throw new RangeError(
        `Registration ${row.registrationId} has more than one outcome`
      );
    }
    map.set(row.registrationId, row);
  }
  return map;
}

function sameOutcome(a: ToldOutcome, b: ToldOutcome): boolean {
  return a.outcome === b.outcome && a.position === b.position;
}

/**
 * The outcomes in `next` that the family hasn't been told yet, given what
 * they were told last time (`previous`, empty the first time).
 */
export function outcomesToTell<Outcome extends Keyed>(
  previous: readonly Keyed[],
  next: readonly Outcome[]
): Outcome[] {
  const told = byRegistration(previous);
  byRegistration(next);
  return next.filter((row) => {
    const last = told.get(row.registrationId);
    return last === undefined || !sameOutcome(last, row);
  });
}
