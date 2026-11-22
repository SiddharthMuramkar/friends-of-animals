import { describe, expect, it } from "vitest";

import {
  decideIndividualRegistration,
  type IndividualRegistrationRequest,
} from "./individual-eligibility";

// 10:00 IST on 15 January 2027.
const AT = new Date("2027-01-15T04:30:00.000Z");

const OPEN = { registrationOpen: true, acceptsIndividuals: true, feeSet: true };

const CHILDREN = { id: "children", label: "6–12", minAge: 6, maxAge: 12 };
const TEENS = { id: "teens", label: "13–17", minAge: 13, maxAge: 17 };
const ADULTS = { id: "adults", label: "Adults", minAge: 18, maxAge: 99 };

const welcome: IndividualRegistrationRequest = {
  competition: {
    ...OPEN,
    ageCutoffDate: "2027-06-01",
    ageGroups: [TEENS, ADULTS],
  },
  dateOfBirth: "1995-08-20",
  registrant: { kind: "self", guardian: "none" },
  alreadyRegistered: false,
  consents: {
    required: ["terms-v2", "privacy-v3"],
    given: ["terms-v2", "privacy-v3"],
  },
  at: AT,
};

const decide = (change: Partial<IndividualRegistrationRequest>) =>
  decideIndividualRegistration({ ...welcome, ...change });

describe("decideIndividualRegistration", () => {
  it("lets an adult register for an open competition that takes individuals", () => {
    expect(decide({})).toEqual({
      ok: true,
      dateOfBirth: { year: 1995, month: 8, day: 20 },
      ageGroup: ADULTS,
      status: "pending_payment",
      askGuardian: false,
    });
  });

  it("places them by their age on the competition's cut-off date", () => {
    // 18 at registration, still 18 on the cut-off: Adults.
    expect(decide({ dateOfBirth: "2008-12-01" })).toMatchObject({
      ok: true,
      ageGroup: ADULTS,
    });
  });

  it("accepts consents given beyond the required ones, in any order", () => {
    expect(
      decide({
        consents: {
          required: ["terms-v2", "privacy-v3"],
          given: ["newsletter-v1", "privacy-v3", "terms-v2"],
        },
      }).ok
    ).toBe(true);
  });

  it("lets a competition with no required documents through", () => {
    expect(decide({ consents: { required: [], given: [] } }).ok).toBe(true);
  });

  it.each([
    [
      "registration is not open",
      { competition: { ...welcome.competition, registrationOpen: false } },
      "registration_closed",
    ],
    [
      "the competition takes institutions only",
      { competition: { ...welcome.competition, acceptsIndividuals: false } },
      "institutions_only",
    ],
    [
      "the individual fee isn't set yet",
      { competition: { ...welcome.competition, feeSet: false } },
      "fee_not_set",
    ],
    [
      "no age group takes an adult of their age",
      { competition: { ...welcome.competition, ageGroups: [TEENS] } },
      "outside_age_groups",
    ],
    [
      "the date of birth does not exist",
      { dateOfBirth: "1995-02-30" },
      "dob_invalid",
    ],
    [
      "the date of birth is in the future",
      { dateOfBirth: "2027-01-16" },
      "dob_invalid",
    ],
    [
      "a child under 13 registers themselves",
      { dateOfBirth: "2014-01-16" },
      "under_13_needs_guardian",
    ],
    [
      "a guardian registers someone who is 18",
      {
        dateOfBirth: "2009-01-15",
        registrant: { kind: "guardian", verified: true },
      },
      "adult_registers_self",
    ],
    [
      "the person is already registered",
      { alreadyRegistered: true },
      "already_registered",
    ],
    [
      "a required consent is missing",
      {
        consents: { required: ["terms-v2", "privacy-v3"], given: ["terms-v2"] },
      },
      "consent_missing",
    ],
  ] as const)("refuses when %s", (_, change, reason) => {
    expect(decide(change)).toEqual({ ok: false, reason });
  });

  it("treats someone a day short of 18 as a minor", () => {
    expect(decide({ dateOfBirth: "2009-01-16" })).toMatchObject({
      ok: true,
      status: "pending_guardian",
    });
  });

  it("lets someone register on their 18th birthday in India", () => {
    expect(decide({ dateOfBirth: "2009-01-15" })).toMatchObject({
      ok: true,
      status: "pending_payment",
    });
  });

  it("holds a 16-year-old registering alone for a guardian to be asked", () => {
    expect(
      decide({
        competition: { ...welcome.competition, ageGroups: [TEENS] },
        dateOfBirth: "2010-03-01",
      })
    ).toEqual({
      ok: true,
      dateOfBirth: { year: 2010, month: 3, day: 1 },
      ageGroup: TEENS,
      status: "pending_guardian",
      askGuardian: true,
    });
  });

  it("lets a teen whose guardian has verified go straight to payment", () => {
    expect(
      decide({
        dateOfBirth: "2011-06-01",
        registrant: { kind: "self", guardian: "verified" },
      })
    ).toMatchObject({
      ok: true,
      ageGroup: TEENS,
      status: "pending_payment",
      askGuardian: false,
    });
  });

  it("lets a verified guardian register their 9-year-old, waiting for payment", () => {
    expect(
      decide({
        competition: {
          ...welcome.competition,
          ageGroups: [CHILDREN, TEENS, ADULTS],
        },
        dateOfBirth: "2017-09-01",
        registrant: { kind: "guardian", verified: true },
      })
    ).toMatchObject({
      ok: true,
      ageGroup: CHILDREN,
      status: "pending_payment",
      askGuardian: false,
    });
  });

  it("gives the competition's reason before anything about the person", () => {
    expect(
      decide({
        competition: {
          ...welcome.competition,
          registrationOpen: false,
          acceptsIndividuals: false,
          feeSet: false,
        },
        dateOfBirth: "2012-03-03",
        alreadyRegistered: true,
        consents: { required: ["terms-v2"], given: [] },
      })
    ).toEqual({ ok: false, reason: "registration_closed" });
    expect(
      decide({
        competition: {
          ...welcome.competition,
          acceptsIndividuals: false,
          feeSet: false,
        },
        dateOfBirth: "2012-03-03",
      })
    ).toEqual({ ok: false, reason: "institutions_only" });
    expect(
      decide({
        competition: { ...welcome.competition, feeSet: false },
        dateOfBirth: "2012-03-03",
      })
    ).toEqual({ ok: false, reason: "fee_not_set" });
  });

  it("tells an adult outside the age groups before a duplicate or consents", () => {
    expect(
      decide({
        competition: { ...welcome.competition, ageGroups: [TEENS] },
        alreadyRegistered: true,
        consents: { required: ["terms-v2"], given: [] },
      })
    ).toEqual({ ok: false, reason: "outside_age_groups" });
  });

  it("tells a child under 13 a guardian registers them before anything they could fix", () => {
    expect(
      decide({
        competition: { ...welcome.competition, ageGroups: [TEENS] },
        dateOfBirth: "2016-03-03",
        alreadyRegistered: true,
        consents: { required: ["terms-v2"], given: [] },
      })
    ).toEqual({ ok: false, reason: "under_13_needs_guardian" });
  });

  it("reports a duplicate before missing consents", () => {
    expect(
      decide({
        alreadyRegistered: true,
        consents: { required: ["terms-v2"], given: [] },
      })
    ).toEqual({ ok: false, reason: "already_registered" });
  });
});
