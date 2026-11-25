// An animal's age (#129). Rescuers rarely know a birthday, so the listing
// form asks for an estimated age in years and months, and the listing
// stores the month that puts the animal at that age now. The age shown and
// filtered on is worked out from that month and the clock, so it stays
// right as the listing ages, and no age is ever stored.
//
// Months are read in India (one time zone, no daylight saving).
//
// Pure: no I/O, no "server-only", no `@/` imports.

/** A calendar month, `YYYY-MM`. */
export type YearMonth = `${number}-${number}`;

export type EstimatedAge = { years: number; months: number };

/** Parrots and tortoises outlive dogs; nothing listed is older. */
export const AGE_LIMITS = { maxYears: 60 } as const;

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Months since year 0, so months can be added and compared as numbers. */
function toIndex(month: YearMonth): number {
  const match = YEAR_MONTH.exec(month);
  if (!match) throw new RangeError(`Not a YYYY-MM month: ${month}`);
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

function fromIndex(index: number): YearMonth {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}` as YearMonth;
}

/** The month `at` falls in, in India. */
export function istMonth(at: Date): YearMonth {
  return new Date(at.getTime() + IST_OFFSET_MS)
    .toISOString()
    .slice(0, 7) as YearMonth;
}

/** The birth month that makes an animal `age` old this month. */
export function estimateBirthMonth(age: EstimatedAge, now: Date): YearMonth {
  const { years, months } = age;
  if (
    !Number.isInteger(years) ||
    !Number.isInteger(months) ||
    years < 0 ||
    years > AGE_LIMITS.maxYears ||
    months < 0 ||
    months > 11
  ) {
    throw new RangeError(
      `An estimated age is 0-${AGE_LIMITS.maxYears} whole years and 0-11 whole months, got ${years} years ${months} months`
    );
  }
  return fromIndex(toIndex(istMonth(now)) - (years * 12 + months));
}

/** Whole months from the birth month to this month; never below 0. */
export function ageInMonths(birthMonth: YearMonth, now: Date): number {
  return Math.max(0, toIndex(istMonth(now)) - toIndex(birthMonth));
}

/** The age to show: "about 2 years 1 month". */
export function ageParts(birthMonth: YearMonth, now: Date): EstimatedAge {
  const months = ageInMonths(birthMonth, now);
  return { years: Math.floor(months / 12), months: months % 12 };
}

/**
 * The age filter's bands, by age in whole months (inclusive). The same
 * bands for every species keep the filter simple; a senior dog and a
 * senior parrot differ, and the listing's notes say so.
 */
const BAND_MONTHS = {
  /** Under 6 months: puppies, kittens, chicks. */
  baby: { min: 0, max: 5 },
  /** 6 months to under 2 years. */
  young: { min: 6, max: 23 },
  /** 2 years to under 8 years. */
  adult: { min: 24, max: 95 },
  /** 8 years and over. */
  senior: { min: 96, max: null },
} as const satisfies Record<string, { min: number; max: number | null }>;

export type AgeBand = keyof typeof BAND_MONTHS;

export const ADOPTION_AGE_BANDS = Object.keys(BAND_MONTHS) as AgeBand[];

export function ageBand(birthMonth: YearMonth, now: Date): AgeBand {
  const months = ageInMonths(birthMonth, now);
  const band = ADOPTION_AGE_BANDS.find((candidate) => {
    const { min, max } = BAND_MONTHS[candidate];
    return months >= min && (max === null || months <= max);
  });
  // The bands cover 0 months up with no gaps, so one always matches.
  return band ?? "senior";
}

/**
 * The birth months (inclusive) of animals in `band` this month, for the
 * browse query: born no earlier than `earliest` (null: no limit) and no
 * later than `latest`.
 */
export function birthMonthRange(
  band: AgeBand,
  now: Date
): { earliest: YearMonth | null; latest: YearMonth } {
  const current = toIndex(istMonth(now));
  const { min, max } = BAND_MONTHS[band];
  return {
    earliest: max === null ? null : fromIndex(current - max),
    latest: fromIndex(current - min),
  };
}

/** The `date` column holds the first of the birth month. */
export function toDateColumn(month: YearMonth): string {
  toIndex(month);
  return `${month}-01`;
}

export function fromDateColumn(date: string): YearMonth {
  if (!/^\d{4}-\d{2}-01$/.test(date)) {
    throw new RangeError(`A birth month is stored as YYYY-MM-01, got ${date}`);
  }
  const month = date.slice(0, 7) as YearMonth;
  toIndex(month);
  return month;
}
