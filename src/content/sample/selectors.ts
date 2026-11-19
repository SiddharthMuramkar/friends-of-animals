import { isPlaceholder, type PlaceholderKey } from "@/lib/site";

import type { Competition, CompetitionStatus, CounterKey, Fee } from "./model";

/** Statuses the home page may show; drafts never appear. */
const HOME_STATUSES: ReadonlySet<CompetitionStatus> = new Set([
  "PUBLISHED",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "IN_PROGRESS",
]);

const closes = (c: Competition) => Date.parse(c.registrationClosesAt);

/** Live and upcoming: open registrations first, soonest closing first. */
export function homeCompetitions(
  list: readonly Competition[],
  limit = 3
): Competition[] {
  return list
    .filter((c) => HOME_STATUSES.has(c.status))
    .toSorted((a, b) => {
      const openA = a.status === "REGISTRATION_OPEN" ? 0 : 1;
      const openB = b.status === "REGISTRATION_OPEN" ? 0 : 1;
      return openA - openB || closes(a) - closes(b);
    })
    .slice(0, limit);
}

export type StatusLabel =
  | "upcoming"
  | "open"
  | "inProgress"
  | "results"
  | "cancelled";
export type StatusTone = "blue" | "green" | "pink" | "neutral" | "marigold";

const CHIP: Record<
  Exclude<CompetitionStatus, "DRAFT">,
  { label: StatusLabel; tone: StatusTone }
> = {
  PUBLISHED: { label: "upcoming", tone: "blue" },
  REGISTRATION_OPEN: { label: "open", tone: "green" },
  REGISTRATION_CLOSED: { label: "inProgress", tone: "pink" },
  IN_PROGRESS: { label: "inProgress", tone: "pink" },
  SCHOOL_JUDGING: { label: "inProgress", tone: "pink" },
  FOA_JUDGING: { label: "inProgress", tone: "pink" },
  RESULTS_PENDING_APPROVAL: { label: "inProgress", tone: "pink" },
  RESULTS_PUBLISHED: { label: "results", tone: "marigold" },
  ARCHIVED: { label: "results", tone: "marigold" },
  CANCELLED: { label: "cancelled", tone: "neutral" },
};

/** One word and a tone per status; null for drafts. */
export function statusChip(
  status: CompetitionStatus
): { label: StatusLabel; tone: StatusTone } | null {
  return status === "DRAFT" ? null : CHIP[status];
}

export type KeyDateKind =
  | "registrationOpens"
  | "registrationCloses"
  | "entriesClose"
  | "shortlistCloses";

/** The next date on the competition's timeline after `now`, if any. */
export function nextKeyDate(
  c: Competition,
  now: Date
): { kind: KeyDateKind; at: string } | null {
  const timeline: [KeyDateKind, string | undefined][] = [
    ["registrationOpens", c.registrationOpensAt],
    ["registrationCloses", c.registrationClosesAt],
    ["entriesClose", c.submissionClosesAt],
    ["shortlistCloses", c.shortlistSubmissionClosesAt],
  ];
  for (const [kind, at] of timeline)
    if (at && Date.parse(at) > now.getTime()) return { kind, at };
  return null;
}

/** Youngest and oldest ages across the age groups. */
export function ageRange(c: Competition): { min: number; max: number } {
  return {
    min: Math.min(...c.ageGroups.map((g) => g.minAge)),
    max: Math.max(...c.ageGroups.map((g) => g.maxAge)),
  };
}

const indian = new Intl.NumberFormat("en-IN");

/**
 * Counts under 10 are omitted; larger counts are floored to a multiple of 10
 * and shown with a plus, e.g. 1,249 → "1,240+".
 */
export function counterDisplay(value: number): string | null {
  if (value < 10) return null;
  return `${indian.format(Math.floor(value / 10) * 10)}+`;
}

export function visibleCounters(
  counters: readonly { key: CounterKey; value: number }[]
): { key: CounterKey; display: string }[] {
  return counters.flatMap(({ key, value }) => {
    const display = counterDisplay(value);
    return display === null ? [] : [{ key, display }];
  });
}

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export type FeeDisplay =
  | { kind: "free" }
  | { kind: "amount"; text: string }
  | { kind: "placeholder"; key: PlaceholderKey };

/** A fee in paise as "₹1,500", "Free", or a placeholder still to be set. */
export function feeDisplay(fee: Fee): FeeDisplay {
  if (isPlaceholder(fee)) return { kind: "placeholder", key: fee.key };
  if (fee === 0) return { kind: "free" };
  return { kind: "amount", text: rupees.format(fee / 100) };
}
