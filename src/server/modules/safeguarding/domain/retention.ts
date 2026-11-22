// How long a safeguarding report is kept (#116). The default follows
// common safeguarding practice: 7 years after the report is resolved, or
// until the child it is about turns 25, whichever is later. An open report
// is kept while it is open. FOA's counsel confirms the periods (residue
// HR-31); #114's retention engine reads the date from here.
//
// The form asks the child's age only roughly (whole years), so the child
// turns 25 no later than `25 - age` years after the report. Rounding that
// way never deletes early. With no age, the child is taken to be a newborn:
// 25 years after the report, the longest the rule could need.
//
// Pure, and loads under plain Node.

/** Years kept after a report is resolved. */
export const YEARS_AFTER_RESOLUTION = 7;
/** Kept at least until the child concerned turns this old. */
export const SUBJECT_AGE_FLOOR = 25;

/** `at` plus `years` calendar years (UTC); 29 February rolls to 1 March. */
function addYears(at: Date, years: number): Date {
  const next = new Date(at.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

/**
 * The earliest instant the report may be deleted, or null while it is
 * still open.
 */
export function reportRetainedUntil(report: {
  reportedAt: Date;
  resolvedAt: Date | null;
  /** The child's age in whole years when the report was filed. */
  subjectAge: number | null;
}): Date | null {
  if (report.resolvedAt === null) return null;
  const afterResolution = addYears(report.resolvedAt, YEARS_AFTER_RESOLUTION);
  const age = Math.max(0, Math.min(report.subjectAge ?? 0, SUBJECT_AGE_FLOOR));
  const turns25 = addYears(report.reportedAt, SUBJECT_AGE_FLOOR - age);
  return afterResolution > turns25 ? afterResolution : turns25;
}
