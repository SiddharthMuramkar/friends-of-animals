// How the UI models a competition: the card both the sample content and
// the database fill (the home page and /styleguide show samples, the
// public pages published competitions), and the detail the public page
// and the admin preview render. Plain data with ISO dates, so it crosses a
// 'use cache' boundary unchanged.
//
// The status, discipline and route words are still the ones the sample
// content defined, with their message keys; the database's values map
// onto them.

import type {
  Competition as SampleCompetition,
  CompetitionStatus,
  Discipline,
  Fee,
  ParticipationRoute,
} from "@/content/sample/model";
import type { KeyDateKind } from "@/content/sample/selectors";
import type { SiteImageId } from "@/lib/images";

export type { CompetitionStatus, Discipline, KeyDateKind, ParticipationRoute };
export { DISCIPLINES } from "@/content/sample/model";
export { statusChip, type StatusLabel } from "@/content/sample/selectors";

/** One date on a competition's public timeline, as an ISO instant. */
export type KeyDate = { kind: KeyDateKind; at: string };

export type AgeGroup = { label: string; minAge: number; maxAge: number };

/** What a competition card shows. */
export type CompetitionCardModel = {
  slug: string;
  name: string;
  theme: string;
  status: CompetitionStatus;
  /** Sample content: the card carries the Sample tag. */
  sample: boolean;
  coverImageId: SiteImageId;
  disciplines: readonly Discipline[];
  ageGroups: readonly AgeGroup[];
  /** The ways in, each with its fee (a placeholder until FOA sets it). */
  routes: readonly { route: ParticipationRoute; fee: Fee }[];
  /** In timeline order. */
  keyDates: readonly KeyDate[];
};

/** A sample competition as a card. */
export function fromSample(c: SampleCompetition): CompetitionCardModel {
  const keyDates: KeyDate[] = [
    { kind: "registrationOpens", at: c.registrationOpensAt },
    { kind: "registrationCloses", at: c.registrationClosesAt },
    { kind: "entriesClose", at: c.submissionClosesAt },
  ];
  if (c.shortlistSubmissionClosesAt)
    keyDates.push({
      kind: "shortlistCloses",
      at: c.shortlistSubmissionClosesAt,
    });
  return {
    slug: c.slug,
    name: c.name,
    theme: c.theme,
    status: c.status,
    sample: true,
    coverImageId: c.coverImageId,
    disciplines: c.disciplines,
    ageGroups: c.ageGroups,
    routes: c.routes.map((r) => ({ route: r.route, fee: r.feeBaseMinor })),
    keyDates,
  };
}

/** The first date after `now`, if any. */
export function nextKeyDate(
  keyDates: readonly KeyDate[],
  now: Date
): KeyDate | null {
  return keyDates.find((d) => Date.parse(d.at) > now.getTime()) ?? null;
}

/** Youngest and oldest ages across the age groups. */
export function ageRange(groups: readonly AgeGroup[]): {
  min: number;
  max: number;
} {
  return {
    min: Math.min(...groups.map((g) => g.minAge)),
    max: Math.max(...groups.map((g) => g.maxAge)),
  };
}

export type TimelineStep = KeyDate & { past: boolean };

/** Every key date, in order; dates before `now` are marked past. */
export function timeline(
  keyDates: readonly KeyDate[],
  now: Date
): TimelineStep[] {
  return keyDates.map((d) => ({
    ...d,
    past: Date.parse(d.at) < now.getTime(),
  }));
}

/**
 * A credited site photo for each discipline, until competitions have a
 * cover of their own. Chosen by the first discipline.
 */
const COVERS: Record<Discipline, SiteImageId> = {
  DRAWING: "sn-myna-goregaon",
  PAINTING: "cat-roof-bougainvillea",
  ART: "kitten-tree-peekaboo",
  CRAFT: "care-kolam-rice",
  ESSAY: "puppies-lounging-cloth",
  PHOTOGRAPHY: "sn-kite-bengaluru",
  VIDEOGRAPHY: "dogs-lalbagh-play",
};

export function coverFor(disciplines: readonly Discipline[]): SiteImageId {
  return COVERS[disciplines[0] ?? "DRAWING"];
}

export type PrimaryAction =
  | "register"
  | "opensSoon"
  | "underway"
  | "results"
  | "cancelled";

/** What the detail page's main call to action offers. */
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

export type FileRule = {
  discipline: Discipline;
  /** Message key for the accepted file types. */
  types: "image" | "essay" | "video";
  files: "art" | "craft" | "one";
  maxMb: number;
  /** Shortest long edge (short edge for video), in pixels. */
  minPx?: number;
  /** Longest written entry, in words (essays). */
  maxWords?: number;
};

/** Default file rules for each discipline. */
const FILE_RULES: Record<Discipline, Omit<FileRule, "discipline">> = {
  DRAWING: { types: "image", files: "art", maxMb: 20, minPx: 1200 },
  PAINTING: { types: "image", files: "art", maxMb: 20, minPx: 1200 },
  ART: { types: "image", files: "art", maxMb: 20, minPx: 1200 },
  CRAFT: { types: "image", files: "craft", maxMb: 20, minPx: 1200 },
  PHOTOGRAPHY: { types: "image", files: "one", maxMb: 20, minPx: 2000 },
  ESSAY: { types: "essay", files: "one", maxMb: 10, maxWords: 1000 },
  VIDEOGRAPHY: { types: "video", files: "one", maxMb: 500, minPx: 720 },
};

export function fileRules(disciplines: readonly Discipline[]): FileRule[] {
  return disciplines.map((discipline) => ({
    discipline,
    ...FILE_RULES[discipline],
  }));
}
