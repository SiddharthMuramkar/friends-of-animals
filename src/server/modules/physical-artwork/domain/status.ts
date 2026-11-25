// The physical artwork status machine (#93). Every status an artwork can
// hold is listed here up front, because a Postgres enum value added in the
// same migration run as DDL that uses it fails: the schema's
// `physical_artwork_status` enum is built from this list once, and later
// tickets only add rows to ARTWORK_TRANSITIONS. Auction states are kept off
// the enum; the auction module records them on its own lots.
//
// Loads under plain Node: no "server-only", no `@/` imports.

import { CUSTODY_TRANSITIONS } from "./custody";

/** Every status, in custody order. */
export const PHYSICAL_ARTWORK_STATUSES = [
  /** FOA asked for the original work. */
  "requested",
  /** The sender recorded the courier and tracking number. */
  "dispatched",
  /** FOA has the parcel. */
  "received",
  /** The work doesn't match its digital entry. */
  "discrepancy",
  /** Checked against the entry; ready for judging. */
  "verified",
  "on_exhibition",
  /** Kept by FOA after the return window. */
  "retained",
  "returned",
] as const;

export type PhysicalArtworkStatus = (typeof PHYSICAL_ARTWORK_STATUSES)[number];

/** Who makes a move: the school or family sending the work, or FOA staff. */
export type ArtworkMover = "sender" | "staff";

export type ArtworkTransition = {
  from: PhysicalArtworkStatus;
  to: PhysicalArtworkStatus;
  by: ArtworkMover;
};

/** The allowed moves. Every pair not listed is refused. */
export const ARTWORK_TRANSITIONS: readonly ArtworkTransition[] = [
  { from: "requested", to: "dispatched", by: "sender" },
  { from: "dispatched", to: "received", by: "staff" },
  // The parcel arrived but the sender never recorded the dispatch.
  { from: "requested", to: "received", by: "staff" },
  ...CUSTODY_TRANSITIONS.map(({ from, to }) => ({
    from,
    to,
    by: "staff" as const,
  })),
];

export function isPhysicalArtworkStatus(
  value: unknown
): value is PhysicalArtworkStatus {
  return (PHYSICAL_ARTWORK_STATUSES as readonly unknown[]).includes(value);
}

/** The move from `from` to `to`, or null when it is refused. */
export function artworkTransition(
  from: PhysicalArtworkStatus,
  to: PhysicalArtworkStatus
): ArtworkTransition | null {
  return (
    ARTWORK_TRANSITIONS.find(
      (transition) => transition.from === from && transition.to === to
    ) ?? null
  );
}
