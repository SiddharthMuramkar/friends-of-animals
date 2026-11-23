import { describe, expect, it } from "vitest";

import {
  documentToGive,
  minorRegistrationHold,
  offeredPurposes,
  scopeRefusal,
  type CompetitionConsentSetup,
  type DocumentRef,
} from "./guardian-purposes";

const doc = (id: string, version = 1): DocumentRef => ({ id, version });

const everythingAttached: CompetitionConsentSetup["attached"] = {
  participation: doc("participation-v1"),
  public_display: doc("public-display-v2", 2),
  social_media: doc("social-v1"),
  auction: doc("auction-v1"),
};

describe("offeredPurposes", () => {
  it("offers every competition purpose, each with the version attached for it", () => {
    expect(
      offeredPurposes({
        publicDisplayAllowed: true,
        auctionAllowed: true,
        attached: everythingAttached,
      })
    ).toEqual([
      { purpose: "participation", document: doc("participation-v1") },
      { purpose: "public_display", document: doc("public-display-v2", 2) },
      { purpose: "display_school", document: doc("public-display-v2", 2) },
      { purpose: "display_city", document: doc("public-display-v2", 2) },
      { purpose: "social_media", document: doc("social-v1") },
      { purpose: "auction", document: doc("auction-v1") },
    ]);
  });

  it("offers no public use when the competition keeps entries private", () => {
    const offered = offeredPurposes({
      publicDisplayAllowed: false,
      auctionAllowed: true,
      attached: everythingAttached,
    }).map((o) => o.purpose);
    expect(offered).toEqual(["participation", "auction"]);
  });

  it("offers auction only when the competition allows it", () => {
    const offered = offeredPurposes({
      publicDisplayAllowed: true,
      auctionAllowed: false,
      attached: everythingAttached,
    }).map((o) => o.purpose);
    expect(offered).not.toContain("auction");
  });

  it("offers nothing that has no document attached to point at", () => {
    const offered = offeredPurposes({
      publicDisplayAllowed: true,
      auctionAllowed: true,
      attached: { participation: doc("participation-v1") },
    }).map((o) => o.purpose);
    expect(offered).toEqual(["participation"]);
  });
});

describe("documentToGive", () => {
  const openCompetition: CompetitionConsentSetup = {
    publicDisplayAllowed: true,
    auctionAllowed: false,
    attached: everythingAttached,
  };

  it("points a competition purpose at the version attached to that competition", () => {
    expect(
      documentToGive("display_city", {
        competition: openCompetition,
        childRegistered: true,
      })
    ).toEqual({ ok: true, document: doc("public-display-v2", 2) });
  });

  it("points communications at the current published version", () => {
    expect(
      documentToGive("communications", {
        competition: null,
        currentDocument: doc("communications-v3", 3),
      })
    ).toEqual({ ok: true, document: doc("communications-v3", 3) });
  });

  it("refuses a competition purpose given without a competition", () => {
    expect(
      documentToGive("participation", {
        competition: null,
        currentDocument: null,
      })
    ).toEqual({ ok: false, reason: "competition_required" });
  });

  it("refuses communications given for one competition: it covers every message", () => {
    expect(
      documentToGive("communications", {
        competition: openCompetition,
        childRegistered: true,
      })
    ).toEqual({ ok: false, reason: "competition_not_allowed" });
  });

  it("refuses a competition the child is not registered in, before anything else about it", () => {
    expect(
      documentToGive("auction", {
        competition: openCompetition,
        childRegistered: false,
      })
    ).toEqual({ ok: false, reason: "not_registered" });
  });

  it("refuses a purpose the competition does not offer", () => {
    expect(
      documentToGive("auction", {
        competition: openCompetition,
        childRegistered: true,
      })
    ).toEqual({ ok: false, reason: "purpose_not_offered" });
  });

  it("refuses communications before any version is published", () => {
    expect(
      documentToGive("communications", {
        competition: null,
        currentDocument: null,
      })
    ).toEqual({ ok: false, reason: "purpose_not_offered" });
  });
});

describe("scopeRefusal", () => {
  it("needs a competition for every purpose except communications", () => {
    expect(scopeRefusal("public_display", "competition-1")).toBeNull();
    expect(scopeRefusal("public_display", null)).toBe("competition_required");
    expect(scopeRefusal("communications", null)).toBeNull();
    expect(scopeRefusal("communications", "competition-1")).toBe(
      "competition_not_allowed"
    );
  });
});

describe("minorRegistrationHold", () => {
  it.each([
    [false, false, false, null],
    [true, false, false, "awaiting_guardian"],
    [true, false, true, "awaiting_guardian"],
    [true, true, false, "participation_consent_required"],
    [true, true, true, null],
  ] as const)(
    "minor %s, guardian verified %s, participation given %s: held for %s",
    (minor, guardianVerified, participationGiven, hold) => {
      expect(
        minorRegistrationHold({ minor, guardianVerified, participationGiven })
      ).toBe(hold);
    }
  );
});
