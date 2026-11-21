// The gallery item's status machine. Pure: no imports, so the schema file
// (which loads under plain Node) can build its pgEnums from the tuples below.
//
// Every status and reason the gallery will ever need is declared now,
// because adding an enum value later and using it in the same migration run
// fails. The whole table is here too, so the units that reach the later
// moves (hide and restore, withdrawal) only call the one status writer.

export const GALLERY_ITEM_STATUSES = [
  "draft",
  "published",
  // Taken down by a content manager, at once.
  "hidden",
  // Taken down by the platform: consent withdrawn or entry disqualified.
  "unpublished",
] as const;

export type GalleryItemStatus = (typeof GALLERY_ITEM_STATUSES)[number];

/** Why the platform took an item down. */
export const GALLERY_UNPUBLISH_REASONS = [
  "consent_withdrawn",
  "disqualified",
] as const;

export type GalleryUnpublishReason = (typeof GALLERY_UNPUBLISH_REASONS)[number];

/** Who makes a move: staff curating, or the platform itself. */
export type GalleryActorKind = "content_manager" | "system";

type Transition = {
  /** `null` is an entry that has no gallery item yet. */
  from: GalleryItemStatus | null;
  to: GalleryItemStatus;
  by: GalleryActorKind;
};

/** Every allowed move. Anything not listed is forbidden. */
export const GALLERY_TRANSITIONS: readonly Transition[] = [
  // Pick an entry with valid public-display consent.
  { from: null, to: "draft", by: "content_manager" },
  // Publish once the stamped copy exists and consent still holds.
  { from: "draft", to: "published", by: "content_manager" },
  // Hide at once, from a report or on sight.
  { from: "published", to: "hidden", by: "content_manager" },
  // Restore through draft, so publishing re-checks consent and re-stamps.
  { from: "hidden", to: "draft", by: "content_manager" },
  // Pick again after consent is given again.
  { from: "unpublished", to: "draft", by: "content_manager" },
  // Withdrawal or disqualification takes the item down from any live state.
  { from: "draft", to: "unpublished", by: "system" },
  { from: "published", to: "unpublished", by: "system" },
  { from: "hidden", to: "unpublished", by: "system" },
];

export function canTransitionGalleryItem(
  from: GalleryItemStatus | null,
  to: GalleryItemStatus,
  by: GalleryActorKind
): boolean {
  return GALLERY_TRANSITIONS.some(
    (transition) =>
      transition.from === from && transition.to === to && transition.by === by
  );
}

/** Thrown when a use case tries a move the machine forbids. */
export class GalleryTransitionError extends Error {
  readonly from: GalleryItemStatus | null;
  readonly to: GalleryItemStatus;
  readonly by: GalleryActorKind;

  constructor(
    from: GalleryItemStatus | null,
    to: GalleryItemStatus,
    by: GalleryActorKind
  ) {
    super(`A gallery item cannot move ${from ?? "(none)"} -> ${to} (${by})`);
    this.name = "GalleryTransitionError";
    this.from = from;
    this.to = to;
    this.by = by;
  }
}

/** Throws `GalleryTransitionError` unless the move is allowed. */
export function assertGalleryTransition(
  from: GalleryItemStatus | null,
  to: GalleryItemStatus,
  by: GalleryActorKind
): void {
  if (!canTransitionGalleryItem(from, to, by)) {
    throw new GalleryTransitionError(from, to, by);
  }
}

/** Whether visitors may see an item in this status. */
export function isPubliclyVisible(status: GalleryItemStatus): boolean {
  return status === "published";
}

/**
 * Whether a move takes an item off the public site: its pages must be
 * revalidated and its public copies retracted.
 */
export function leavesPublicSite(
  from: GalleryItemStatus | null,
  to: GalleryItemStatus
): boolean {
  return from !== null && isPubliclyVisible(from) && !isPubliclyVisible(to);
}
