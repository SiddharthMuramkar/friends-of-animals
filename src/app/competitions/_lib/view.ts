import type {
  Competition,
  CompetitionStatus,
  Discipline,
} from "@/content/sample/model";
import { type StatusLabel, statusChip } from "@/content/sample/selectors";

/**
 * Age bands for the /competitions age filter. Fixed, so the filter's CSS can
 * name each one; a competition matches every band its age groups overlap.
 */
export const AGE_BANDS = [
  { key: "a5", min: 5, max: 8 },
  { key: "a9", min: 9, max: 12 },
  { key: "a13", min: 13, max: 17 },
  { key: "a18", min: 18, max: 30 },
] as const;
export type AgeBandKey = (typeof AGE_BANDS)[number]["key"];

/** Space-separated tokens for a card's data-* attributes (CSS filters). */
export function filterTokens(c: Competition): {
  status: StatusLabel;
  disciplines: string;
  ages: string;
} {
  const chip = statusChip(c.status);
  const bands = AGE_BANDS.filter((b) =>
    c.ageGroups.some((g) => g.minAge <= b.max && g.maxAge >= b.min)
  ).map((b) => b.key);
  return {
    status: chip?.label ?? "upcoming",
    disciplines: c.disciplines.join(" "),
    ages: bands.join(" "),
  };
}

export type PrimaryAction =
  | "register"
  | "opensSoon"
  | "underway"
  | "results"
  | "cancelled";

/** What the detail page's main call to action offers (SPEC §6.11). */
export function primaryAction(status: CompetitionStatus): PrimaryAction {
  switch (status) {
    case "REGISTRATION_OPEN":
      return "register";
    case "DRAFT":
    case "PUBLISHED":
      return "opensSoon";
    case "RESULTS_PUBLISHED":
    case "ARCHIVED":
      return "results";
    case "CANCELLED":
      return "cancelled";
    default:
      return "underway";
  }
}

export type TimelineKind =
  | "registrationOpens"
  | "registrationCloses"
  | "confirmation"
  | "making"
  | "entriesClose"
  | "shortlistCloses";

export type TimelineStep = {
  kind: TimelineKind;
  at: string;
  /** For a window (making the work): when it ends. */
  end?: string;
  past: boolean;
};

/** Every public date, in order; steps before `now` are marked past. */
export function timeline(c: Competition, now?: Date): TimelineStep[] {
  const t = now?.getTime() ?? Number.NEGATIVE_INFINITY;
  const steps: Omit<TimelineStep, "past">[] = [
    { kind: "registrationOpens", at: c.registrationOpensAt },
    { kind: "registrationCloses", at: c.registrationClosesAt },
    { kind: "confirmation", at: c.confirmationDeadline },
    { kind: "making", at: c.conductStartsAt, end: c.conductEndsAt },
    { kind: "entriesClose", at: c.submissionClosesAt },
  ];
  if (c.shortlistSubmissionClosesAt)
    steps.push({ kind: "shortlistCloses", at: c.shortlistSubmissionClosesAt });
  return steps.map((s) => ({
    ...s,
    past: Date.parse(s.end ?? s.at) < t,
  }));
}

export type FileRule = {
  discipline: Discipline;
  /** Message key for the accepted file types. */
  types: "image" | "essay" | "video";
  files: "art" | "craft" | "one";
  maxMb: number;
  /** Shortest long edge (short edge for video), in pixels. */
  minPx?: number;
};

/** SPEC §6.8.3 default file rules. */
const FILE_RULES: Record<Discipline, Omit<FileRule, "discipline">> = {
  DRAWING: { types: "image", files: "art", maxMb: 20, minPx: 1200 },
  PAINTING: { types: "image", files: "art", maxMb: 20, minPx: 1200 },
  ART: { types: "image", files: "art", maxMb: 20, minPx: 1200 },
  CRAFT: { types: "image", files: "craft", maxMb: 20, minPx: 1200 },
  PHOTOGRAPHY: { types: "image", files: "one", maxMb: 20, minPx: 2000 },
  ESSAY: { types: "essay", files: "one", maxMb: 10 },
  VIDEOGRAPHY: { types: "video", files: "one", maxMb: 500, minPx: 720 },
};

export function fileRules(disciplines: readonly Discipline[]): FileRule[] {
  return disciplines.map((discipline) => ({
    discipline,
    ...FILE_RULES[discipline],
  }));
}

const PLACEHOLDER_SLUG = "__placeholder__";

/**
 * generateStaticParams for /competitions/[slug]. Cache Components needs at
 * least one param, so with no competitions (production today) a placeholder
 * is returned and the page answers it with notFound().
 */
export function competitionParams(
  list: readonly Competition[]
): { slug: string }[] {
  const slugs = list
    .filter((c) => c.status !== "DRAFT")
    .map((c) => ({ slug: c.slug }));
  return slugs.length > 0 ? slugs : [{ slug: PLACEHOLDER_SLUG }];
}
