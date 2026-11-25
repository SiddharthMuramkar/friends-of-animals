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
import { placeholder } from "@/lib/site";
import type {
  DigitalScope,
  Discipline as StoredDiscipline,
  KeyDateKind as StoredKeyDateKind,
  Participation,
  PhysicalArtwork,
  PublicCompetition,
} from "@/server/modules/competitions";
import type { PublicCompetitionTerms } from "@/server/modules/competitions/terms";

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

/** Which registration options are actually offered by a real open competition. */
export function liveRegistrationMode(
  c: Pick<CompetitionCardModel, "status" | "sample" | "routes">
): "school" | "individual" | "both" | null {
  if (c.sample || c.status !== "REGISTRATION_OPEN") return null;
  const school = c.routes.some((r) => r.route === "INSTITUTION");
  const individual = c.routes.some((r) => r.route === "INDIVIDUAL");
  return school
    ? individual
      ? "both"
      : "school"
    : individual
      ? "individual"
      : null;
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

type TermsFee = PublicCompetitionTerms["fees"][number];

/**
 * A competition's fees, prizes and pinned documents (#72) as its page
 * shows them. Paise are digits, not a bigint, so the view survives JSON.
 */
export type CompetitionTermsView = {
  fees: readonly (
    | Exclude<TermsFee, { kind: "amount" }>
    | { route: TermsFee["route"]; kind: "amount"; paise: string }
  )[];
  awards: PublicCompetitionTerms["awards"];
  documents: PublicCompetitionTerms["documents"];
};

function termsView(terms: PublicCompetitionTerms): CompetitionTermsView {
  return {
    fees: terms.fees.map((line) =>
      line.kind === "amount" ? { ...line, paise: line.paise.toString() } : line
    ),
    awards: terms.awards,
    documents: terms.documents,
  };
}

/** What a competition's page shows: the card, and the rest of its rules. */
export type CompetitionView = CompetitionCardModel & {
  welfareMessage: string;
  categories: readonly { discipline: Discipline; ageGroup: string }[];
  /** YYYY-MM-DD: ages count on this day. */
  ageCutoffDate: string;
  rules: string;
  permittedMaterials: string;
  duration: string;
  digitalScope: DigitalScope;
  shortlistPerCategory: number;
  schoolPositions: number;
  physicalArtwork: PhysicalArtwork;
  publicDisplay: boolean;
  auctionPermitted: boolean;
  /** Null when the read carries none. */
  terms: CompetitionTermsView | null;
};

const KEY_DATE_KIND: Record<StoredKeyDateKind, KeyDateKind> = {
  registration_opens: "registrationOpens",
  registration_closes: "registrationCloses",
  submissions_close: "entriesClose",
  school_round_closes: "shortlistCloses",
};

const STATUS: Record<PublicCompetition["status"], CompetitionStatus> = {
  published: "PUBLISHED",
  registration_open: "REGISTRATION_OPEN",
  registration_closed: "REGISTRATION_CLOSED",
  school_judging: "SCHOOL_JUDGING",
  foa_judging: "FOA_JUDGING",
  results_published: "RESULTS_PUBLISHED",
  cancelled: "CANCELLED",
};

const toDiscipline = (d: StoredDiscipline) => d.toUpperCase() as Discipline;

/**
 * Schools first, as the page recommends them. Fees arrive with #72; until
 * then each shows as still to be confirmed, never an invented amount.
 */
const ROUTES: Record<Participation, CompetitionCardModel["routes"]> = {
  individuals: [{ route: "INDIVIDUAL", fee: placeholder("feeIndividual") }],
  institutions: [{ route: "INSTITUTION", fee: placeholder("feeSchool") }],
  both: [
    { route: "INSTITUTION", fee: placeholder("feeSchool") },
    { route: "INDIVIDUAL", fee: placeholder("feeIndividual") },
  ],
};

/**
 * A competition from the module's public view (the read model, or a
 * draft's preview) as its page and card show it, with its terms if the
 * read has them.
 */
export function fromPublic(
  c: PublicCompetition & { terms?: PublicCompetitionTerms }
): CompetitionView {
  const disciplines = c.disciplines.map(toDiscipline);
  return {
    slug: c.slug,
    name: c.name,
    theme: c.theme,
    status: STATUS[c.status],
    sample: false,
    coverImageId: coverFor(disciplines),
    disciplines,
    ageGroups: c.ageGroups.map(({ label, minAge, maxAge }) => ({
      label,
      minAge,
      maxAge,
    })),
    routes: ROUTES[c.participation],
    keyDates: c.keyDates.map((d) => ({
      kind: KEY_DATE_KIND[d.kind],
      at: d.at.toISOString(),
    })),
    welfareMessage: c.welfareMessage,
    categories: c.categories.map((cat) => ({
      discipline: toDiscipline(cat.discipline),
      ageGroup: cat.ageGroup,
    })),
    ageCutoffDate: c.ageCutoffDate,
    rules: c.rules,
    permittedMaterials: c.permittedMaterials,
    duration: c.duration,
    digitalScope: c.digitalScope,
    shortlistPerCategory: c.shortlistPerCategory,
    schoolPositions: c.schoolPositions,
    physicalArtwork: c.physicalArtwork,
    publicDisplay: c.publicDisplay,
    auctionPermitted: c.auctionPermitted,
    terms: c.terms ? termsView(c.terms) : null,
  };
}

/**
 * A manager's plain text (welfare message, rules, materials) as
 * paragraphs, one per line. It renders as text, never as markup.
 */
export function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
