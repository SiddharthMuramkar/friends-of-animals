import { describe, expect, it } from "vitest";

import {
  effectOfConsentWithdrawal,
  effectOfGalleryLeavingPublic,
  SOCIAL_TAKEDOWN_REASONS,
  socialQueueRefusal,
  type SocialEffect,
  type SocialTakedownReason,
} from "./effects";
import type { SocialQueueStatus } from "./status";

describe("socialQueueRefusal", () => {
  const eligible = {
    galleryPublished: true,
    hasSocialCredit: true,
    hasActiveQueueItem: false,
  };

  it("lets a published item with social-media consent be queued", () => {
    expect(socialQueueRefusal(eligible)).toBeNull();
  });

  it("refuses an item that is not on the public gallery", () => {
    expect(socialQueueRefusal({ ...eligible, galleryPublished: false })).toBe(
      "gallery_item_not_published"
    );
  });

  it("refuses an item whose subject has no social-media consent", () => {
    expect(socialQueueRefusal({ ...eligible, hasSocialCredit: false })).toBe(
      "no_social_media_consent"
    );
  });

  it("refuses an item already pending or posted", () => {
    expect(socialQueueRefusal({ ...eligible, hasActiveQueueItem: true })).toBe(
      "already_queued"
    );
  });

  it("names the missing consent before the existing queue item", () => {
    expect(
      socialQueueRefusal({
        galleryPublished: true,
        hasSocialCredit: false,
        hasActiveQueueItem: true,
      })
    ).toBe("no_social_media_consent");
  });

  it("names the unpublished gallery item first", () => {
    expect(
      socialQueueRefusal({
        galleryPublished: false,
        hasSocialCredit: false,
        hasActiveQueueItem: true,
      })
    ).toBe("gallery_item_not_published");
  });
});

describe("SOCIAL_TAKEDOWN_REASONS", () => {
  it("declares every reason a takedown alert will ever carry", () => {
    expect(SOCIAL_TAKEDOWN_REASONS).toEqual([
      "consent_withdrawn",
      "gallery_unpublished",
      "credit_changed",
    ]);
  });
});

const NONE: SocialEffect = { kind: "none" };
const alert = (reason: SocialTakedownReason): SocialEffect => ({
  kind: "alert",
  reason,
});

describe("effectOfConsentWithdrawal", () => {
  // purpose, status, earlier alert, expected effect: written out by hand.
  const TABLE: readonly (readonly [
    string,
    SocialQueueStatus,
    SocialTakedownReason | null,
    SocialEffect,
  ])[] = [
    // Losing the right to post at all takes a pending item off the queue...
    [
      "social_media",
      "pending",
      null,
      { kind: "remove", reason: "consent_withdrawn" },
    ],
    [
      "public_display",
      "pending",
      null,
      { kind: "remove", reason: "consent_withdrawn" },
    ],
    // ...and asks people to take a posted one down.
    ["social_media", "posted", null, alert("consent_withdrawn")],
    ["public_display", "posted", null, alert("consent_withdrawn")],
    // A removed item is out of the picture.
    ["social_media", "removed", null, NONE],
    ["public_display", "removed", null, NONE],
    // School or city opt-ins only change the credit: a pending item picks
    // the new credit up when it is read, a posted one needs editing.
    ["display_school", "pending", null, NONE],
    ["display_city", "pending", null, NONE],
    ["display_school", "posted", null, alert("credit_changed")],
    ["display_city", "posted", null, alert("credit_changed")],
    ["display_city", "removed", null, NONE],
    // Purposes that say nothing about public use touch nothing.
    ["participation", "pending", null, NONE],
    ["participation", "posted", null, NONE],
    ["auction", "posted", null, NONE],
    ["communications", "pending", null, NONE],
    // One alert per need: a second takedown request adds nothing...
    ["social_media", "posted", "consent_withdrawn", NONE],
    ["public_display", "posted", "gallery_unpublished", NONE],
    ["display_school", "posted", "credit_changed", NONE],
    // ...nor does a credit edit after a takedown was asked for...
    ["display_city", "posted", "consent_withdrawn", NONE],
    // ...but a takedown after a credit edit was asked for is new.
    ["social_media", "posted", "credit_changed", alert("consent_withdrawn")],
  ];

  it.each(TABLE)(
    "withdrawing %s from a %s item (alerted before: %s)",
    (purpose, status, alerted, expected) => {
      expect(effectOfConsentWithdrawal(purpose, { status, alerted })).toEqual(
        expected
      );
    }
  );
});

describe("effectOfGalleryLeavingPublic", () => {
  const TABLE: readonly (readonly [
    SocialQueueStatus,
    SocialTakedownReason | null,
    SocialEffect,
  ])[] = [
    ["pending", null, { kind: "remove", reason: "gallery_unpublished" }],
    ["posted", null, alert("gallery_unpublished")],
    ["posted", "credit_changed", alert("gallery_unpublished")],
    ["posted", "consent_withdrawn", NONE],
    ["posted", "gallery_unpublished", NONE],
    ["removed", null, NONE],
  ];

  it.each(TABLE)(
    "a %s item (alerted before: %s)",
    (status, alerted, expected) => {
      expect(effectOfGalleryLeavingPublic({ status, alerted })).toEqual(
        expected
      );
    }
  );
});
