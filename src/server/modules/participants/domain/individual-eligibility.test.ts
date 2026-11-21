import { describe, expect, it } from "vitest";

import {
  decideIndividualRegistration,
  type IndividualRegistrationRequest,
} from "./individual-eligibility";

// 10:00 IST on 15 January 2027.
const AT = new Date("2027-01-15T04:30:00.000Z");

const welcome: IndividualRegistrationRequest = {
  competition: { registrationOpen: true, acceptsIndividuals: true },
  dateOfBirth: "1995-08-20",
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
      { competition: { registrationOpen: false, acceptsIndividuals: true } },
      "registration_closed",
    ],
    [
      "the competition takes institutions only",
      { competition: { registrationOpen: true, acceptsIndividuals: false } },
      "institutions_only",
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
    ["the person is under 18", { dateOfBirth: "2009-01-16" }, "minor"],
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

  it("lets someone register on their 18th birthday in India", () => {
    expect(decide({ dateOfBirth: "2009-01-15" }).ok).toBe(true);
  });

  it("gives the competition's reason before anything about the person", () => {
    expect(
      decide({
        competition: { registrationOpen: false, acceptsIndividuals: false },
        dateOfBirth: "2012-03-03",
        alreadyRegistered: true,
        consents: { required: ["terms-v2"], given: [] },
      })
    ).toEqual({ ok: false, reason: "registration_closed" });
    expect(
      decide({
        competition: { registrationOpen: true, acceptsIndividuals: false },
        dateOfBirth: "2012-03-03",
      })
    ).toEqual({ ok: false, reason: "institutions_only" });
  });

  it("tells a minor to come back before asking for anything they could fix", () => {
    expect(
      decide({
        dateOfBirth: "2012-03-03",
        alreadyRegistered: true,
        consents: { required: ["terms-v2"], given: [] },
      })
    ).toEqual({ ok: false, reason: "minor" });
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
