// Which age group a participant belongs to in a competition (#75). The age
// is completed years on the competition's cut-off date, and a group takes
// every age from its minimum to its maximum, both included. We store the
// date of birth and the group, never the age.
//
// Pure: the caller loads the groups and the cut-off.

import { type CalendarDate, completedYearsOn } from "./calendar-date";

/** One of a competition's age groups (#70a). */
export type AgeGroup = {
  id: string;
  label: string;
  minAge: number;
  maxAge: number;
};

export type AgeGroupResult =
  | { ok: true; group: AgeGroup; age: number }
  /** Too young, too old, or between two groups. `groups` is youngest first. */
  | { ok: false; reason: "outside_age_groups"; age: number; groups: AgeGroup[] }
  /** The competition's groups overlap: a setup mistake for staff to fix. */
  | {
      ok: false;
      reason: "overlapping_age_groups";
      age: number;
      groups: AgeGroup[];
    }
  | { ok: false; reason: "no_age_groups" };

export function ageGroupFor(
  dateOfBirth: CalendarDate,
  cutoff: CalendarDate,
  groups: readonly AgeGroup[]
): AgeGroupResult {
  if (groups.length === 0) return { ok: false, reason: "no_age_groups" };
  const age = completedYearsOn(dateOfBirth, cutoff);
  const matches = groups.filter(
    (group) => group.minAge <= age && age <= group.maxAge
  );
  if (matches.length > 1) {
    return {
      ok: false,
      reason: "overlapping_age_groups",
      age,
      groups: matches,
    };
  }
  const [group] = matches;
  if (group) return { ok: true, group, age };
  return {
    ok: false,
    reason: "outside_age_groups",
    age,
    groups: [...groups].sort((a, b) => a.minAge - b.minAge),
  };
}
