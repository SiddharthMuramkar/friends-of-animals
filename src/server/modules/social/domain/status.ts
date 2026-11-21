// The social queue item's status machine. Pure: no imports, so the schema
// file (which loads under plain Node) can build its pgEnums from the tuples
// below.
//
// Every status and reason the queue will ever need is declared now, because
// adding an enum value later and using it in the same migration run fails.

export const SOCIAL_QUEUE_STATUSES = [
  // Waiting for someone to post it by hand.
  "pending",
  // Posted by hand. Final: taking a post down is a human act off-platform.
  "posted",
  // Left the queue before it was posted. Final: queueing again makes a new row.
  "removed",
] as const;

export type SocialQueueStatus = (typeof SOCIAL_QUEUE_STATUSES)[number];

/** Why a pending item left the queue. */
export const SOCIAL_REMOVAL_REASONS = [
  // Social-media or public-display consent was withdrawn.
  "consent_withdrawn",
  // The gallery item left the public site: hidden or unpublished.
  "gallery_unpublished",
  // A content manager took it off the queue.
  "manual",
] as const;

export type SocialRemovalReason = (typeof SOCIAL_REMOVAL_REASONS)[number];

/** Who makes a move: staff working the queue, or the platform itself. */
export type SocialActorKind = "content_manager" | "system";

type Transition = {
  /** `null` is a gallery item that has no active queue item. */
  from: SocialQueueStatus | null;
  to: SocialQueueStatus;
  by: SocialActorKind;
  /** Set exactly when `to` is "removed". */
  reason: SocialRemovalReason | null;
};

/** Every allowed move. Anything not listed is forbidden. */
export const SOCIAL_QUEUE_TRANSITIONS: readonly Transition[] = [
  // Queue a published gallery item that has social-media consent.
  { from: null, to: "pending", by: "content_manager", reason: null },
  // Someone posted it by hand.
  { from: "pending", to: "posted", by: "content_manager", reason: null },
  // Taken off the queue by hand.
  { from: "pending", to: "removed", by: "content_manager", reason: "manual" },
  // The platform takes it off when consent or the gallery item goes.
  {
    from: "pending",
    to: "removed",
    by: "system",
    reason: "consent_withdrawn",
  },
  {
    from: "pending",
    to: "removed",
    by: "system",
    reason: "gallery_unpublished",
  },
];

export function canTransitionSocialQueueItem(
  from: SocialQueueStatus | null,
  to: SocialQueueStatus,
  by: SocialActorKind,
  reason: SocialRemovalReason | null
): boolean {
  return SOCIAL_QUEUE_TRANSITIONS.some(
    (transition) =>
      transition.from === from &&
      transition.to === to &&
      transition.by === by &&
      transition.reason === reason
  );
}

/** Thrown when a use case tries a move the machine forbids. */
export class SocialQueueTransitionError extends Error {
  readonly from: SocialQueueStatus | null;
  readonly to: SocialQueueStatus;
  readonly by: SocialActorKind;
  readonly reason: SocialRemovalReason | null;

  constructor(
    from: SocialQueueStatus | null,
    to: SocialQueueStatus,
    by: SocialActorKind,
    reason: SocialRemovalReason | null
  ) {
    super(
      `A social queue item cannot move ${from ?? "(none)"} -> ${to} (${by})`
    );
    this.name = "SocialQueueTransitionError";
    this.from = from;
    this.to = to;
    this.by = by;
    this.reason = reason;
  }
}

/** Throws `SocialQueueTransitionError` unless the move is allowed. */
export function assertSocialQueueTransition(
  from: SocialQueueStatus | null,
  to: SocialQueueStatus,
  by: SocialActorKind,
  reason: SocialRemovalReason | null
): void {
  if (!canTransitionSocialQueueItem(from, to, by, reason)) {
    throw new SocialQueueTransitionError(from, to, by, reason);
  }
}

/** Only a caption that hasn't been posted yet can still change. */
export function canEditCaption(status: SocialQueueStatus): boolean {
  return status === "pending";
}
