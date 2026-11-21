// Period months and Indian financial years for the transparency page (#110).
// The ledger files every posting under a period month, `YYYY-MM` counted in
// IST; finance locks whole months, and a locked month is a published one.
// The page groups published months by financial year, 1 April to 31 March,
// labelled the way Indian accounts write it: "2026-27".
// Pure; no imports.

/** A ledger period: `YYYY-MM`, the month in IST. */
export type PeriodMonth = string;

export type FinancialYear = {
  /** The calendar year in which this FY's April falls. */
  startYear: number;
  /** How the page shows it and how `?fy=` names it, e.g. "2026-27". */
  label: string;
};

const PERIOD_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const FY_LABEL = /^(\d{4})-(\d{2})$/;

/** April, counting January as 1. */
const APRIL = 4;

export function isPeriodMonth(value: string): boolean {
  return PERIOD_MONTH.test(value);
}

function financialYear(startYear: number): FinancialYear {
  const end = String((startYear + 1) % 100).padStart(2, "0");
  return { startYear, label: `${startYear}-${end}` };
}

/** The financial year a period month belongs to. */
export function financialYearOfMonth(month: PeriodMonth): FinancialYear {
  const match = PERIOD_MONTH.exec(month);
  if (!match) {
    throw new RangeError(`Not a period month: ${JSON.stringify(month)}`);
  }
  const year = Number(match[1]);
  return financialYear(Number(match[2]) >= APRIL ? year : year - 1);
}

/** The twelve period months of `fy`, April first. */
export function monthsOfFinancialYear(fy: FinancialYear): PeriodMonth[] {
  return Array.from({ length: 12 }, (_, i) => {
    const monthOfYear = ((APRIL - 1 + i) % 12) + 1;
    const year = monthOfYear >= APRIL ? fy.startYear : fy.startYear + 1;
    return `${year}-${String(monthOfYear).padStart(2, "0")}`;
  });
}

/** Reads a label like "2026-27", or null if it isn't one. */
export function parseFinancialYearLabel(label: string): FinancialYear | null {
  const match = FY_LABEL.exec(label);
  if (!match) return null;
  const startYear = Number(match[1]);
  const fy = financialYear(startYear);
  return fy.label === label ? fy : null;
}

/** Every financial year with at least one locked month, newest first. */
export function publishedFinancialYears(
  lockedMonths: Iterable<PeriodMonth>
): FinancialYear[] {
  const startYears = new Set<number>();
  for (const month of lockedMonths) {
    startYears.add(financialYearOfMonth(month).startYear);
  }
  return [...startYears].sort((a, b) => b - a).map(financialYear);
}

/**
 * The year the page shows: the one asked for if it has a published month,
 * else the year of the latest locked month (so in April the page still
 * shows the year just closed, not an empty new one). Null while nothing is
 * published.
 */
export function pickFinancialYear(
  requested: string | undefined,
  lockedMonths: Iterable<PeriodMonth>
): FinancialYear | null {
  const published = publishedFinancialYears(lockedMonths);
  const wanted =
    requested === undefined ? null : parseFinancialYearLabel(requested);
  if (wanted && published.some((fy) => fy.label === wanted.label)) {
    return wanted;
  }
  return published[0] ?? null;
}
