// The adoption listing status machine (#129). A verified directory listing's
// representative writes a draft, publishes it, may put it on hold (an
// adoption is being discussed, or the animal is unwell) and may withdraw it.
// An adoption coordinator closes it as adopted when an application succeeds
// (#130). Edits to an open listing are not status changes.
//
// The `adoption_listing_status` enum in the schema is built from this list.
// Every status exists from the start, so later work adds allowed moves
// here, never values to the enum (a value added and used in one migration
// run fails).
//
// Pure: no I/O, no "server-only", no `@/` imports.

export const ADOPTION_LISTING_STATUSES = [
  /** Being written. Only the listing's representatives see it. */
  "draft",
  /** On /adopt, in browse results and on its own page. */
  "published",
  /** Out of browse results; its page still opens, marked on hold. */
  "on_hold",
  /** Closed by a successful adoption. Its page still opens. Final. */
  "adopted",
  /** Taken down by its representative. Final. */
  "withdrawn",
] as const;

export type AdoptionListingStatus = (typeof ADOPTION_LISTING_STATUSES)[number];

/**
 * Who makes a move: a representative of the directory listing that owns
 * the animal, or FOA's adoption coordinator.
 */
export type AdoptionMover = "representative" | "coordinator";

export type AdoptionTrigger =
  | "created"
  | "published"
  | "held"
  | "resumed"
  | "adopted"
  | "withdrawn";

type Move = {
  /** null: the row is being created. */
  from: AdoptionListingStatus | null;
  to: AdoptionListingStatus;
  trigger: AdoptionTrigger;
  by: readonly AdoptionMover[];
};

export const ADOPTION_LISTING_MOVES: readonly Move[] = [
  { from: null, to: "draft", trigger: "created", by: ["representative"] },
  {
    from: "draft",
    to: "published",
    trigger: "published",
    by: ["representative"],
  },
  {
    from: "published",
    to: "on_hold",
    trigger: "held",
    by: ["representative"],
  },
  {
    from: "on_hold",
    to: "published",
    trigger: "resumed",
    by: ["representative"],
  },
  // Recorded by the coordinator when an application ends in an adoption.
  { from: "published", to: "adopted", trigger: "adopted", by: ["coordinator"] },
  { from: "on_hold", to: "adopted", trigger: "adopted", by: ["coordinator"] },
  // A draft that will never be published is withdrawn, not deleted, so the
  // audit log and its photos still resolve.
  {
    from: "draft",
    to: "withdrawn",
    trigger: "withdrawn",
    by: ["representative"],
  },
  {
    from: "published",
    to: "withdrawn",
    trigger: "withdrawn",
    by: ["representative"],
  },
  {
    from: "on_hold",
    to: "withdrawn",
    trigger: "withdrawn",
    by: ["representative"],
  },
];

export class AdoptionTransitionError extends Error {
  constructor(
    from: AdoptionListingStatus | null,
    to: AdoptionListingStatus,
    by: AdoptionMover
  ) {
    super(
      `An adoption listing can't move from ${from ?? "(new)"} to ${to} (${by})`
    );
    this.name = "AdoptionTransitionError";
  }
}

/** Whether the table lets `by` move a listing from `from` to `to`. */
export function canMoveAdoptionListing(
  from: AdoptionListingStatus | null,
  to: AdoptionListingStatus,
  by: AdoptionMover
): boolean {
  return ADOPTION_LISTING_MOVES.some(
    (move) => move.from === from && move.to === to && move.by.includes(by)
  );
}

/** Returns `to`, or throws AdoptionTransitionError for a forbidden move. */
export function moveAdoptionListing(
  from: AdoptionListingStatus | null,
  to: AdoptionListingStatus,
  by: AdoptionMover
): AdoptionListingStatus {
  if (!canMoveAdoptionListing(from, to, by)) {
    throw new AdoptionTransitionError(from, to, by);
  }
  return to;
}

/** Whether details and photos may still change: not once it is closed. */
export function acceptsChanges(status: AdoptionListingStatus): boolean {
  return status === "draft" || status === "published" || status === "on_hold";
}

/**
 * What the public may see of a listing. `listed`: in browse results and on
 * its page. `page_only`: its page opens (shared links keep working) with an
 * on-hold or adopted notice, but browse leaves it out. `hidden`: a 404.
 * Nothing of a directory listing that isn't verified (pending, rejected,
 * suspended or withdrawn) is public, whatever the animal's status.
 */
export function publicVisibility(
  status: AdoptionListingStatus,
  directoryListingVerified: boolean
): "listed" | "page_only" | "hidden" {
  if (!directoryListingVerified) return "hidden";
  switch (status) {
    case "published":
      return "listed";
    case "on_hold":
    case "adopted":
      return "page_only";
    case "draft":
    case "withdrawn":
      return "hidden";
  }
}
