// When a personal-data record may go (#114). A record is kept for its
// retention period, a runtime setting in days, counted from its anchor (the
// instant the policy measures from: created, expired, read, answered). Some
// records also carry a statutory floor that no setting can shorten:
// financial records stay until 8 years after the end of their financial
// year (HR-31, HR-47: confirm with counsel and the accountant).
//
// Pure, and loads under plain Node: the worker's schedule runs it.

const DAY_MS = 24 * 60 * 60 * 1000;

/** India Standard Time is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** A minimum keeping time that settings can't shorten. */
export type LegalFloor =
  /** Kept at least this many days after the anchor. */
  | { kind: "days"; days: number }
  /**
   * Kept until `years` after the end of the Indian financial year
   * (1 April to 31 March, IST) the anchor falls in.
   */
  | { kind: "financial_years"; years: number };

/** The instant `floor` stops protecting a record anchored at `anchor`. */
export function floorLapsesAt(anchor: Date, floor: LegalFloor): Date {
  if (floor.kind === "days") {
    return new Date(anchor.getTime() + floor.days * DAY_MS);
  }
  const ist = new Date(anchor.getTime() + IST_OFFSET_MS);
  // Months are 0-based: 3 is April, when a financial year starts.
  const startYear =
    ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  // The year ends at midnight IST starting 1 April of startYear + 1.
  return new Date(Date.UTC(startYear + 1 + floor.years, 3, 1) - IST_OFFSET_MS);
}

/**
 * Whether a record anchored at `anchor` has outlived both its retention
 * period (`days`) and its floor at `now`. A record goes at the instant its
 * period is complete, not a day later.
 */
export function isExpired(input: {
  anchor: Date;
  now: Date;
  days: number;
  floor?: LegalFloor | undefined;
}): boolean {
  const { anchor, now, days, floor } = input;
  if (now.getTime() - anchor.getTime() < days * DAY_MS) return false;
  return floor === undefined || now >= floorLapsesAt(anchor, floor);
}

/**
 * The shortest time `floor` can keep a record, in whole days: the lowest
 * retention setting that isn't plainly below the floor. The settings screen
 * refuses less; the engine still checks each record's exact floor.
 */
export function minimumFloorDays(floor: LegalFloor | undefined): number {
  if (floor === undefined) return 1;
  if (floor.kind === "days") return floor.days;
  // A record made at the very end of a financial year waits only the
  // `years` after it, which hold one leap day in every four.
  return floor.years * 365 + Math.floor(floor.years / 4);
}
