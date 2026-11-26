import { describe, expect, it } from "vitest";

import {
  assessLotEligibility,
  LISTABLE_ARTWORK_STATUSES,
  type ArtworkAuctionFacts,
} from "./eligibility";

/** An adult's verified artwork, consented by the adult, in a competition
 * that allows auctions, not listed yet: eligible. */
const ELIGIBLE_ADULT: ArtworkAuctionFacts = {
  artworkStatus: "verified",
  openDiscrepancy: false,
  openReturnRequest: false,
  returnWindowClosed: true,
  competitionAllowsAuction: true,
  creatorIsMinor: false,
  auctionConsent: { state: "given", by: "creator", guardianVerified: false },
  inActiveLot: false,
};

/** The same for a minor whose verified guardian gave auction consent. */
const ELIGIBLE_MINOR: ArtworkAuctionFacts = {
  ...ELIGIBLE_ADULT,
  creatorIsMinor: true,
  auctionConsent: { state: "given", by: "guardian", guardianVerified: true },
};

describe("an artwork that may become a lot", () => {
  it("is verified, on exhibition or retained", () => {
    expect(LISTABLE_ARTWORK_STATUSES).toEqual([
      "verified",
      "on_exhibition",
      "retained",
    ]);
  });

  it.each(LISTABLE_ARTWORK_STATUSES)(
    "is eligible when %s with the creator's consent",
    (artworkStatus) => {
      expect(
        assessLotEligibility({ ...ELIGIBLE_ADULT, artworkStatus })
      ).toEqual({ eligible: true });
    }
  );

  it("is eligible for a minor with a verified guardian's consent", () => {
    expect(assessLotEligibility(ELIGIBLE_MINOR)).toEqual({ eligible: true });
  });
});

describe("an artwork that may not become a lot", () => {
  it.each([
    "requested",
    "dispatched",
    "received",
    "discrepancy",
    "returned",
    "auction_listed",
    "auctioned",
  ])("is %s", (artworkStatus) => {
    expect(assessLotEligibility({ ...ELIGIBLE_ADULT, artworkStatus })).toEqual({
      eligible: false,
      reasons: ["artwork_not_listable"],
    });
  });

  it.each([
    [
      "has an open discrepancy",
      { openDiscrepancy: true },
      ["open_discrepancy"],
    ],
    [
      "has an open return request",
      { openReturnRequest: true },
      ["return_requested"],
    ],
    [
      "is from a competition that doesn't allow auctions",
      { competitionAllowsAuction: false },
      ["competition_not_auctionable"],
    ],
    ["is in an active lot already", { inActiveLot: true }, ["already_listed"]],
    [
      "has no auction consent, or it was withdrawn",
      { auctionConsent: { state: "none" } },
      ["auction_consent_missing"],
    ],
    [
      "is an adult's, with consent from someone else (a guardian, earlier)",
      {
        auctionConsent: {
          state: "given",
          by: "guardian",
          guardianVerified: true,
        },
      },
      ["auction_consent_missing"],
    ],
    [
      "is an adult's, covered only by the institution's declaration",
      {
        auctionConsent: {
          state: "given",
          by: "institution",
          guardianVerified: false,
        },
      },
      ["auction_consent_missing"],
    ],
  ] as const)("%s", (_, change, reasons) => {
    expect(assessLotEligibility({ ...ELIGIBLE_ADULT, ...change })).toEqual({
      eligible: false,
      reasons,
    });
  });

  it.each([
    ["has no auction consent", { state: "none" }, ["auction_consent_missing"]],
    [
      "has only the teen's own consent",
      { state: "given", by: "creator", guardianVerified: false },
      ["guardian_consent_required"],
    ],
    [
      "is covered only by the institution's declaration",
      { state: "given", by: "institution", guardianVerified: false },
      ["guardian_consent_required"],
    ],
    [
      "has consent from a guardian who isn't verified",
      { state: "given", by: "guardian", guardianVerified: false },
      ["guardian_not_verified"],
    ],
  ] as const)("is a minor's that %s", (_, auctionConsent, reasons) => {
    expect(assessLotEligibility({ ...ELIGIBLE_MINOR, auctionConsent })).toEqual(
      { eligible: false, reasons }
    );
  });

  it("gives every reason at once, in a fixed order", () => {
    expect(
      assessLotEligibility({
        artworkStatus: "received",
        openDiscrepancy: true,
        openReturnRequest: true,
        returnWindowClosed: false,
        competitionAllowsAuction: false,
        creatorIsMinor: true,
        auctionConsent: {
          state: "given",
          by: "guardian",
          guardianVerified: false,
        },
        inActiveLot: true,
      })
    ).toEqual({
      eligible: false,
      reasons: [
        "artwork_not_listable",
        "open_discrepancy",
        "return_requested",
        "return_window_pending",
        "already_listed",
        "competition_not_auctionable",
        "guardian_not_verified",
      ],
    });
  });
});
