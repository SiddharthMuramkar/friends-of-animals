// The words under a competition's status chip: when the schedule moves it
// next, as an absolute time in IST and how far off that is. Once the
// instant has passed but the status shown has not moved yet (the worker
// makes the move within seconds, and a public page's cached read refreshes
// from a minute after the instant, see src/app/competitions/_lib/
// cache-life.ts), it says the move is happening shortly instead of
// counting below zero.
//
// Pure: the caller passes next-intl's translator and formatter, so the
// same words render on the server and in tests.

import type { CompetitionStatus } from "@/server/modules/competitions/domain/status-machine";
import type { UpcomingChange } from "@/server/modules/competitions/domain/status-schedule";

type CountdownKey =
  | "opens"
  | "opensDue"
  | "closes"
  | "closesDue"
  | "entriesClose"
  | "entriesCloseDue"
  | "shortlistsClose"
  | "shortlistsCloseDue";

export type CountdownIntl = {
  t: (key: CountdownKey, values?: { at: string; relative: string }) => string;
  format: {
    dateTime(value: Date, format: "longDateTime"): string;
    relativeTime(value: Date, now: Date): string;
  };
};

/** The messages for each status the schedule can move a competition to. */
const KEYS: Record<
  Exclude<CompetitionStatus, "draft" | "published" | "cancelled">,
  { scheduled: CountdownKey; due: CountdownKey }
> = {
  registration_open: { scheduled: "opens", due: "opensDue" },
  registration_closed: { scheduled: "closes", due: "closesDue" },
  school_judging: { scheduled: "entriesClose", due: "entriesCloseDue" },
  foa_judging: { scheduled: "shortlistsClose", due: "shortlistsCloseDue" },
};

/** The countdown sentence for `change`, or null when nothing is ahead. */
export function countdownText(
  change: UpcomingChange,
  now: Date,
  intl: CountdownIntl
): string | null {
  if (
    !change ||
    change.to === "draft" ||
    change.to === "published" ||
    change.to === "cancelled"
  ) {
    return null;
  }
  const keys = KEYS[change.to];
  if (change.kind === "due") return intl.t(keys.due);
  return intl.t(keys.scheduled, {
    at: intl.format.dateTime(change.at, "longDateTime"),
    relative: intl.format.relativeTime(change.at, now),
  });
}
