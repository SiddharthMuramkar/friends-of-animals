// What a draft needs before it can be published. Saving a draft accepts
// gaps; publishing refuses until this list is empty, and the admin form
// shows each problem against its field.

import { ageGroupProblems, type AgeGroupInput } from "./age-groups";
import { keyDateProblems, type KeyDateKind, type KeyDates } from "./key-dates";
import {
  schoolsTakePart,
  type Discipline,
  type Participation,
  type PhysicalArtwork,
} from "./vocabulary";

/** A category is one discipline for one age group, named by its label. */
export type CategoryInput = { discipline: Discipline; ageGroup: string };

export type PublishCandidate = {
  name: string | null;
  theme: string | null;
  welfareMessage: string | null;
  rules: string | null;
  permittedMaterials: string | null;
  duration: string | null;
  participation: Participation | null;
  disciplines: readonly Discipline[];
  ageGroups: readonly AgeGroupInput[];
  categories: readonly CategoryInput[];
  /** YYYY-MM-DD, a calendar date with no time zone. */
  ageCutoffDate: string | null;
  shortlistPerCategory: number;
  schoolPositions: number;
  physicalArtwork: PhysicalArtwork;
  keyDates: KeyDates;
};

const REQUIRED_TEXT = [
  "name",
  "theme",
  "welfareMessage",
  "rules",
  "permittedMaterials",
  "duration",
] as const;

type TextField = (typeof REQUIRED_TEXT)[number];

export type PublishProblem =
  | {
      field:
        | TextField
        | "participation"
        | "disciplines"
        | "ageCutoffDate"
        | "categories";
      code: "required";
    }
  | { field: "ageCutoffDate"; code: "invalid" }
  | {
      field: "ageGroups";
      code: "none";
    }
  | {
      field: "ageGroups";
      code: "label_required" | "range_inverted" | "age_out_of_bounds";
      index: number;
    }
  | {
      field: "ageGroups";
      code: "label_duplicate" | "overlaps";
      index: number;
      other: number;
    }
  | {
      field: "categories";
      code: "unknown_discipline" | "unknown_age_group";
      index: number;
    }
  | {
      field: "shortlistPerCategory" | "schoolPositions" | "physicalArtwork";
      code: "out_of_range";
    }
  | {
      field: "keyDates";
      code: "required" | "not_applicable";
      kind: KeyDateKind;
    }
  | {
      field: "keyDates";
      code: "must_follow";
      kind: KeyDateKind;
      other: KeyDateKind;
    };

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `value` is YYYY-MM-DD and that day exists. */
export function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

const isBlank = (text: string | null) => text === null || text.trim() === "";

/** Every reason `candidate` can't be published yet; empty when it can. */
export function publishProblems(candidate: PublishCandidate): PublishProblem[] {
  const problems: PublishProblem[] = [];

  for (const field of REQUIRED_TEXT)
    if (isBlank(candidate[field])) problems.push({ field, code: "required" });

  const { participation } = candidate;
  if (participation === null)
    problems.push({ field: "participation", code: "required" });
  if (candidate.disciplines.length === 0)
    problems.push({ field: "disciplines", code: "required" });

  if (candidate.ageCutoffDate === null)
    problems.push({ field: "ageCutoffDate", code: "required" });
  else if (!isCalendarDate(candidate.ageCutoffDate))
    problems.push({ field: "ageCutoffDate", code: "invalid" });

  for (const problem of ageGroupProblems(candidate.ageGroups))
    problems.push({ field: "ageGroups", ...problem });

  if (candidate.categories.length === 0)
    problems.push({ field: "categories", code: "required" });
  const labels = new Set(
    candidate.ageGroups.map((g) => g.label.trim().toLowerCase())
  );
  candidate.categories.forEach((category, index) => {
    if (!candidate.disciplines.includes(category.discipline))
      problems.push({ field: "categories", code: "unknown_discipline", index });
    else if (!labels.has(category.ageGroup.trim().toLowerCase()))
      problems.push({ field: "categories", code: "unknown_age_group", index });
  });

  const schools = participation !== null && schoolsTakePart(participation);
  if (schools) {
    const { shortlistPerCategory, schoolPositions, physicalArtwork } =
      candidate;
    if (!Number.isInteger(shortlistPerCategory) || shortlistPerCategory < 1)
      problems.push({ field: "shortlistPerCategory", code: "out_of_range" });
    if (!Number.isInteger(schoolPositions) || schoolPositions < 0)
      problems.push({ field: "schoolPositions", code: "out_of_range" });
    if (
      physicalArtwork.kind === "top_n" &&
      !(
        Number.isInteger(physicalArtwork.count) &&
        physicalArtwork.count >= 1 &&
        physicalArtwork.count <= shortlistPerCategory
      )
    )
      problems.push({ field: "physicalArtwork", code: "out_of_range" });
  }

  if (participation !== null)
    for (const { field: kind, ...problem } of keyDateProblems(
      candidate.keyDates,
      participation
    ))
      problems.push({ field: "keyDates", kind, ...problem });

  return problems;
}

/** Every discipline crossed with every age group: a new draft's categories. */
export function everyCategory(
  disciplines: readonly Discipline[],
  ageGroupLabels: readonly string[]
): CategoryInput[] {
  return disciplines.flatMap((discipline) =>
    ageGroupLabels.map((ageGroup) => ({ discipline, ageGroup }))
  );
}
