// The engagement timeline's entry kinds and how the page groups them.
// Pure; loads under plain Node.
//
// Entry kinds are text in the database, checked against this registry, not
// a Postgres enum: later tickets add kinds (events #125c, volunteering
// #124, clubs #121), and a registry line needs no migration. Each kind
// belongs to one category, which the page uses for its icon and label.

import type { MilestoneKind } from "./milestones";

/** What a timeline entry is about. */
export const TIMELINE_CATEGORIES = [
  "competition",
  "recognition",
  "community",
  "event",
  "volunteering",
] as const;

export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number];

/**
 * Every entry kind and its category. A ticket that writes a new kind of
 * entry adds one line here (and its label in the `community` messages).
 */
export const TIMELINE_ENTRY_KINDS = {
  "milestone.participant": "competition",
  "milestone.school_winner": "recognition",
  "milestone.foa_finalist": "recognition",
  "milestone.community_member": "community",
  "milestone.volunteer": "volunteering",
  "milestone.ambassador": "recognition",
} as const satisfies Record<`${string}.${string}`, TimelineCategory>;

export type TimelineEntryKind = keyof typeof TIMELINE_ENTRY_KINDS;

/** Whether `kind` (read from the database or an event) is registered. */
export function isTimelineEntryKind(kind: string): kind is TimelineEntryKind {
  return Object.hasOwn(TIMELINE_ENTRY_KINDS, kind);
}

/** The entry a milestone puts on the timeline. */
export function timelineKindForMilestone(
  kind: MilestoneKind
): TimelineEntryKind {
  return `milestone.${kind}`;
}

export function timelineCategory(kind: TimelineEntryKind): TimelineCategory {
  return TIMELINE_ENTRY_KINDS[kind];
}

/** India Standard Time is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The calendar year in India at `instant`. */
function istYear(instant: Date): number {
  return new Date(instant.getTime() + IST_OFFSET_MS).getUTCFullYear();
}

type Dated = { id: string; occurredAt: Date };

/**
 * The journey in order, oldest first, with ties broken by id (UUIDv7, so
 * by creation), grouped by the year in India. Leaves `entries` unchanged.
 */
export function groupTimelineByYear<Entry extends Dated>(
  entries: readonly Entry[]
): { year: number; entries: Entry[] }[] {
  const ordered = [...entries].sort(
    (a, b) =>
      a.occurredAt.getTime() - b.occurredAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const groups: { year: number; entries: Entry[] }[] = [];
  for (const entry of ordered) {
    const year = istYear(entry.occurredAt);
    const last = groups.at(-1);
    if (last?.year === year) last.entries.push(entry);
    else groups.push({ year, entries: [entry] });
  }
  return groups;
}
