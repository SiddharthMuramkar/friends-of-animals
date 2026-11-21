// The directory listing status machine (#127). A listing starts pending
// verification and stays private until FOA staff verify it. Staff verify,
// reject, suspend and reinstate, always with a reason. The listing's owner
// (before verification) or representative (after) may withdraw it, with an
// optional reason, and edit it:
//
//   - detail edits (description, services, contacts, address, website,
//     which contacts are public) go live at once and are audited;
//   - identity edits (name, type) on a verified listing send it back to
//     pending verification, because verification vouches for who the
//     organisation is.
//
// Rejected and withdrawn are final: the organisation registers again.
// Suspended listings can't be edited until staff reinstate them.
//
// Loads under plain Node (schema, seed script): relative imports only, no
// "server-only".

/** In the order a listing usually meets them. */
export const LISTING_STATUSES = [
  "pending_verification",
  "verified",
  "rejected",
  "suspended",
  "withdrawn",
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const INITIAL_LISTING_STATUS: ListingStatus = "pending_verification";

/** Staff decisions first, then what the listing's own people can do. */
export const LISTING_ACTIONS = [
  "verify",
  "reject",
  "suspend",
  "reinstate",
  "withdraw",
  "edit_details",
  "edit_identity",
] as const;

export type ListingAction = (typeof LISTING_ACTIONS)[number];

/** The actions only FOA staff take. Each needs a reason. */
export const STAFF_LISTING_ACTIONS = [
  "verify",
  "reject",
  "suspend",
  "reinstate",
] as const satisfies readonly ListingAction[];

export type StaffListingAction = (typeof STAFF_LISTING_ACTIONS)[number];

/** What happened to the listing, as the audit log and messages name it. */
export type ListingOutcome =
  | "verified"
  | "rejected"
  | "suspended"
  | "reinstated"
  | "withdrawn"
  | "edited"
  | "resubmitted";

/** Outbox events the directory emits. */
export const DIRECTORY_EVENTS = [
  "directory.listing_submitted",
  "directory.listing_verified",
  "directory.listing_rejected",
  "directory.listing_suspended",
  "directory.listing_reinstated",
] as const;

export type DirectoryEvent = (typeof DIRECTORY_EVENTS)[number];

/** Emitted when a listing is registered. */
export const LISTING_SUBMITTED_EVENT: DirectoryEvent =
  "directory.listing_submitted";

type Move = {
  to: ListingStatus;
  outcome: ListingOutcome;
  event: DirectoryEvent | null;
};

/** Every allowed move. An action missing from a status is refused. */
const TRANSITIONS: Record<
  ListingStatus,
  Partial<Record<ListingAction, Move>>
> = {
  pending_verification: {
    verify: {
      to: "verified",
      outcome: "verified",
      event: "directory.listing_verified",
    },
    reject: {
      to: "rejected",
      outcome: "rejected",
      event: "directory.listing_rejected",
    },
    withdraw: { to: "withdrawn", outcome: "withdrawn", event: null },
    edit_details: {
      to: "pending_verification",
      outcome: "edited",
      event: null,
    },
    edit_identity: {
      to: "pending_verification",
      outcome: "edited",
      event: null,
    },
  },
  verified: {
    suspend: {
      to: "suspended",
      outcome: "suspended",
      event: "directory.listing_suspended",
    },
    withdraw: { to: "withdrawn", outcome: "withdrawn", event: null },
    edit_details: { to: "verified", outcome: "edited", event: null },
    edit_identity: {
      to: "pending_verification",
      outcome: "resubmitted",
      event: "directory.listing_submitted",
    },
  },
  rejected: {},
  suspended: {
    reinstate: {
      to: "verified",
      outcome: "reinstated",
      event: "directory.listing_reinstated",
    },
  },
  withdrawn: {},
};

export const STATUS_REASON_MAX_LENGTH = 1000;

export type ListingStatusChange =
  | {
      ok: true;
      to: ListingStatus;
      outcome: ListingOutcome;
      /** The outbox event to emit in the same transaction, if any. */
      event: DirectoryEvent | null;
      /**
       * True on the first verification: the owner is granted
       * organisation_representative for this listing. A reinstated listing
       * kept its representative through the suspension.
       */
      grantsRepresentative: boolean;
      /** Trimmed, as stored and shown; null when none is recorded. */
      reason: string | null;
    }
  | {
      ok: false;
      error: "transition_not_allowed" | "reason_required" | "reason_too_long";
    };

function isStaffAction(action: ListingAction): action is StaffListingAction {
  return (STAFF_LISTING_ACTIONS as readonly ListingAction[]).includes(action);
}

/** Where `action` takes a listing in status `from`, if anywhere. */
export function decideListingStatus(input: {
  from: ListingStatus;
  action: ListingAction;
  reason?: string | undefined;
}): ListingStatusChange {
  const move = TRANSITIONS[input.from][input.action];
  if (!move) return { ok: false, error: "transition_not_allowed" };
  const grantsRepresentative =
    input.from === "pending_verification" && move.to === "verified";
  if (input.action === "edit_details" || input.action === "edit_identity") {
    return { ok: true, ...move, grantsRepresentative, reason: null };
  }
  const reason = (input.reason ?? "").trim();
  if (reason.length > STATUS_REASON_MAX_LENGTH) {
    return { ok: false, error: "reason_too_long" };
  }
  if (reason === "" && isStaffAction(input.action)) {
    return { ok: false, error: "reason_required" };
  }
  return {
    ok: true,
    ...move,
    grantsRepresentative,
    reason: reason === "" ? null : reason,
  };
}

/** Whether the public may see a listing in this status. */
export function isPubliclyListed(status: ListingStatus): boolean {
  return status === "verified";
}
