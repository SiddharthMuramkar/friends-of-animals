// What the social queue does when the world around an item changes: who may
// be queued, and what a consent withdrawal or a gallery takedown does to a
// queued item. The consumers and the queue use case only carry out what
// these functions decide, so the policy (HR-44) lives in this one file.
//
// Pure: loads under plain Node.

import type { SocialQueueStatus } from "./status";

export type SocialQueueRefusal =
  | "gallery_item_not_published"
  | "no_social_media_consent"
  | "already_queued";

/**
 * Why a gallery item can't be queued, or null when it can. The most basic
 * problem is named first.
 */
export function socialQueueRefusal(facts: {
  /** The gallery item is on the public site now. */
  galleryPublished: boolean;
  /** #82's resolver gives a credit for social media: consent holds. */
  hasSocialCredit: boolean;
  /** The item already has a pending or posted queue item. */
  hasActiveQueueItem: boolean;
}): SocialQueueRefusal | null {
  if (!facts.galleryPublished) return "gallery_item_not_published";
  if (!facts.hasSocialCredit) return "no_social_media_consent";
  if (facts.hasActiveQueueItem) return "already_queued";
  return null;
}

/** Why content managers are asked to act on a post already made by hand. */
export const SOCIAL_TAKEDOWN_REASONS = [
  // Take the post down: consent to post it is gone.
  "consent_withdrawn",
  // Take the post down: the work left the public gallery.
  "gallery_unpublished",
  // Edit the post: the credit now shows less (school or city opt-in gone).
  "credit_changed",
] as const;

export type SocialTakedownReason = (typeof SOCIAL_TAKEDOWN_REASONS)[number];

export type SocialEffect =
  | { kind: "none" }
  /** Move the pending item to removed with this reason. */
  | { kind: "remove"; reason: "consent_withdrawn" | "gallery_unpublished" }
  /** Alert content managers about the posted item. */
  | { kind: "alert"; reason: SocialTakedownReason };

/** A queue item as the effects see it. */
export type SocialItemState = {
  status: SocialQueueStatus;
  /** The reason content managers were last alerted with, if ever. */
  alerted: SocialTakedownReason | null;
};

const NONE: SocialEffect = { kind: "none" };

/** Consent purposes whose loss means the work may not be posted at all. */
const POSTING_PURPOSES: ReadonlySet<string> = new Set([
  "social_media",
  "public_display",
]);

/** Consent purposes that only change what the credit shows. */
const CREDIT_PURPOSES: ReadonlySet<string> = new Set([
  "display_school",
  "display_city",
]);

/** A takedown request covers any edit; an edit request covers only edits. */
function alertFor(
  reason: SocialTakedownReason,
  alerted: SocialTakedownReason | null
): SocialEffect {
  if (alerted === null) return { kind: "alert", reason };
  const isNews = alerted === "credit_changed" && reason !== "credit_changed";
  return isNews ? { kind: "alert", reason } : NONE;
}

/** What withdrawing one consent purpose does to the subject's queue item. */
export function effectOfConsentWithdrawal(
  purpose: string,
  item: SocialItemState
): SocialEffect {
  if (POSTING_PURPOSES.has(purpose)) {
    if (item.status === "pending") {
      return { kind: "remove", reason: "consent_withdrawn" };
    }
    if (item.status === "posted") {
      return alertFor("consent_withdrawn", item.alerted);
    }
    return NONE;
  }
  if (CREDIT_PURPOSES.has(purpose) && item.status === "posted") {
    // A pending item reads the new credit next time; nothing to change.
    return alertFor("credit_changed", item.alerted);
  }
  return NONE;
}

/** What the gallery item being hidden or unpublished does to its queue item. */
export function effectOfGalleryLeavingPublic(
  item: SocialItemState
): SocialEffect {
  if (item.status === "pending") {
    return { kind: "remove", reason: "gallery_unpublished" };
  }
  if (item.status === "posted") {
    return alertFor("gallery_unpublished", item.alerted);
  }
  return NONE;
}
