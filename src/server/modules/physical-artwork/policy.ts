// Who may take each staff action on physical artwork (#93). A role counts
// when its grant is global or scoped to the artwork's competition, and
// every one of these is a staff role, so it also needs the second factor
// (#60). Super admin is not a wildcard. Senders are not here: an artwork
// belongs to its sender (platform.ts `senderScope`), and a sender only
// ever finds their own.
//
// Once #59's policy is on this branch, these lists become its `role(...)`
// rules in PHYSICAL_ARTWORK_POLICY. `foa_verifier` is the staff role #92
// adds.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { ArtworkStaffAction } from "./platform";

export const ARTWORK_STAFF_ROLES = {
  /** Asking verified entries to send their original work. */
  "artwork.request": ["competition_manager"],
  /** Marking a parcel received. */
  "artwork.receive": ["staff_admin", "competition_manager", "foa_verifier"],
  /** The staff board and an artwork's detail. */
  "artwork.read": ["staff_admin", "competition_manager", "foa_verifier"],
} as const satisfies Record<ArtworkStaffAction, readonly string[]>;

export type ArtworkStaffRole =
  (typeof ARTWORK_STAFF_ROLES)[ArtworkStaffAction][number];
