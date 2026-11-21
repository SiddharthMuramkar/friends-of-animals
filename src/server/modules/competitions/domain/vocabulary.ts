// The competition vocabulary: the values the schema's enums, the use cases'
// input validation and the admin form share. Pure, and loads under plain
// Node (drizzle-kit, the seed script): relative imports only.

/**
 * Where a competition is in its life. A draft is never public; #71 adds the
 * statuses that follow publishing, #80 cancelled. School judging (#88)
 * starts once submissions close and every discipline has a published
 * rubric.
 */
export const COMPETITION_STATUSES = [
  "draft",
  "published",
  "school_judging",
] as const;
export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

/** The seven disciplines FOA runs. */
export const DISCIPLINES = [
  "drawing",
  "painting",
  "art",
  "craft",
  "essay",
  "photography",
  "videography",
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

/** Who may enter: individuals, institutions or both. */
export const PARTICIPATIONS = ["individuals", "institutions", "both"] as const;
export type Participation = (typeof PARTICIPATIONS)[number];

/** Whether institutions take part, so the school round applies. */
export function schoolsTakePart(participation: Participation): boolean {
  return participation !== "individuals";
}

/** Who submits digitally. Every participant unless the competition says so. */
export const DIGITAL_SCOPES = ["all_participants", "shortlist_only"] as const;
export type DigitalScope = (typeof DIGITAL_SCOPES)[number];

/** Which entries must send the physical artwork. */
export const PHYSICAL_ARTWORK_KINDS = [
  "not_required",
  "all_shortlisted",
  "top_n",
] as const;
export type PhysicalArtworkKind = (typeof PHYSICAL_ARTWORK_KINDS)[number];

export type PhysicalArtwork =
  | { kind: "not_required" }
  | { kind: "all_shortlisted" }
  | { kind: "top_n"; count: number };

/** Defaults from the product rules: 5 shortlisted per category, 3 positions. */
export const COMPETITION_DEFAULTS = {
  digitalScope: "all_participants",
  shortlistPerCategory: 5,
  schoolPositions: 3,
  physicalArtwork: { kind: "all_shortlisted" },
  publicDisplay: false,
  auctionPermitted: false,
} as const satisfies {
  digitalScope: DigitalScope;
  shortlistPerCategory: number;
  schoolPositions: number;
  physicalArtwork: PhysicalArtwork;
  publicDisplay: boolean;
  auctionPermitted: boolean;
};
