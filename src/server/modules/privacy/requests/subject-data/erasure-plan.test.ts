import { describe, expect, it } from "vitest";

import {
  planErasure,
  retainedCategories,
  retainedUntil,
  type ErasureFacts,
} from "./erasure-plan";

const FLOOR = new Date("2035-03-31T18:30:00.000Z");

const NONE: ErasureFacts = {
  onLegalHold: false,
  givenConsents: 0,
  accounts: 0,
  accountKeeper: null,
  signIn: 0,
  roles: 0,
  messages: 0,
  guardianRecords: 0,
  uploads: 0,
  entries: 0,
  communityHistory: 0,
  surveyFeedback: 0,
  volunteerService: 0,
  auctionBids: 0,
  freeRegistrations: 0,
  keptRegistrations: 0,
  guardianLinks: 0,
  directoryListings: 0,
  directoryPublications: 0,
  deletableProfiles: 0,
  keptProfiles: 0,
  keptProfileBasis: "financial_record",
  payments: 0,
  paymentsUntil: null,
  donorRecognition: 0,
  recurringMandates: 0,
  donationRecords: 0,
  children: 0,
  consentRecords: 0,
  auditEntries: 0,
  privacyRequests: 0,
};

const member: ErasureFacts = {
  ...NONE,
  givenConsents: 1,
  accounts: 1,
  signIn: 2,
  messages: 3,
  consentRecords: 1,
};

describe("planErasure", () => {
  it("deletes an unpaid member's records and keeps the consent proof", () => {
    const plan = planErasure(member);
    expect(
      plan.categories.map((each) => [each.key, each.action, each.basis])
    ).toEqual([
      ["consents", "withdraw", null],
      ["sign_in", "delete", null],
      ["messages", "delete", null],
      ["account", "delete", null],
      ["consent_records", "retain", "consent_proof"],
    ]);
    expect(plan.outcome).toBe("partially_completed");
    expect(retainedCategories(plan)).toEqual([
      { category: "consent_records", basis: "consent_proof", until: null },
    ]);
  });

  it("completes in full when nothing must stay", () => {
    expect(planErasure({ ...NONE, accounts: 1, signIn: 1 }).outcome).toBe(
      "completed"
    );
  });

  it("keeps a payer's account and payments until the floor, anonymising the paid profile", () => {
    const plan = planErasure({
      ...member,
      accountKeeper: { basis: "financial_floor", until: FLOOR },
      keptRegistrations: 1,
      keptProfiles: 1,
      payments: 1,
      paymentsUntil: FLOOR,
    });
    expect(plan.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "account",
          action: "retain",
          basis: "financial_floor",
          until: FLOOR,
        }),
        expect.objectContaining({
          key: "kept_profile",
          action: "anonymise",
          basis: "financial_record",
        }),
        expect.objectContaining({
          key: "payments",
          action: "retain",
          until: FLOOR,
        }),
      ])
    );
    expect(retainedUntil(plan)).toEqual(FLOOR);
  });

  it("keeps everything under a legal hold but still withdraws consents", () => {
    const plan = planErasure({ ...member, onLegalHold: true, entries: 2 });
    expect(
      plan.categories.map((each) => [each.key, each.action, each.basis])
    ).toEqual([
      ["consents", "withdraw", null],
      ["sign_in", "retain", "legal_hold"],
      ["messages", "retain", "legal_hold"],
      ["entries", "retain", "legal_hold"],
      ["account", "retain", "legal_hold"],
      ["consent_records", "retain", "legal_hold"],
    ]);
    expect(plan.outcome).toBe("partially_completed");
  });

  it("fingerprints decisions and stable donor/mandate counts, not changing message counts", () => {
    const one = planErasure(member);
    expect(
      planErasure({ ...member, messages: 40, signIn: 9 }).fingerprint
    ).toBe(one.fingerprint);
    expect(
      planErasure({
        ...member,
        accountKeeper: { basis: "financial_floor", until: FLOOR },
      }).fingerprint
    ).not.toBe(one.fingerprint);
    expect(
      planErasure({ ...member, recurringMandates: 1 }).fingerprint
    ).not.toBe(one.fingerprint);
    expect(
      planErasure({ ...member, donorRecognition: 1 }).fingerprint
    ).not.toBe(one.fingerprint);
    // A kind of record appearing (a message delivered, an entry made)
    // doesn't change it; a legal hold does.
    expect(planErasure({ ...member, entries: 1 }).fingerprint).toBe(
      one.fingerprint
    );
    expect(planErasure({ ...member, onLegalHold: true }).fingerprint).not.toBe(
      one.fingerprint
    );
  });
});
