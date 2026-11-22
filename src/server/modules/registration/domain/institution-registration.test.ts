import { describe, expect, it } from "vitest";

import {
  decideInstitutionRegistration,
  INSTITUTION_REGISTRATION_STATUSES,
  type InstitutionRegistrationFacts,
} from "./institution-registration";

const ELIGIBLE: InstitutionRegistrationFacts = {
  window: "open",
  participation: "institutions",
  institutionStatus: "verified",
  alreadyRegistered: false,
};

describe("decideInstitutionRegistration", () => {
  it("knows the statuses this ticket introduces", () => {
    expect(INSTITUTION_REGISTRATION_STATUSES).toEqual(["active"]);
  });

  it.each(["institutions", "both"] as const)(
    "registers a verified institution while open, when the competition takes %s",
    (participation) => {
      expect(
        decideInstitutionRegistration({ ...ELIGIBLE, participation })
      ).toEqual({ ok: true, status: "active" });
    }
  );

  it.each([
    ["unpublished competition", { window: "unpublished" }, "not_found"],
    [
      "individuals only",
      { participation: "individuals" },
      "institutions_not_accepted",
    ],
    [
      "pending institution",
      { institutionStatus: "pending_verification" },
      "institution_not_verified",
    ],
    [
      "rejected institution",
      { institutionStatus: "rejected" },
      "institution_not_verified",
    ],
    [
      "suspended institution",
      { institutionStatus: "suspended" },
      "institution_not_verified",
    ],
    ["second registration", { alreadyRegistered: true }, "already_registered"],
    ["before opening", { window: "not_open_yet" }, "not_open_yet"],
    ["after closing", { window: "closed" }, "closed"],
  ] as const)("refuses: %s", (_case, change, reason) => {
    expect(decideInstitutionRegistration({ ...ELIGIBLE, ...change })).toEqual({
      ok: false,
      reason,
    });
  });

  // When several things are wrong, the first row that applies wins.
  it.each([
    [
      "an unpublished competition hides everything else",
      {
        window: "unpublished",
        participation: "individuals",
        institutionStatus: "rejected",
        alreadyRegistered: true,
      },
      "not_found",
    ],
    [
      "the route comes before the institution",
      { participation: "individuals", institutionStatus: "suspended" },
      "institutions_not_accepted",
    ],
    [
      "verification comes before an existing registration",
      { institutionStatus: "suspended", alreadyRegistered: true },
      "institution_not_verified",
    ],
    [
      "an existing registration is named even after closing",
      { alreadyRegistered: true, window: "closed" },
      "already_registered",
    ],
    [
      "an existing registration is named before opening",
      { alreadyRegistered: true, window: "not_open_yet" },
      "already_registered",
    ],
  ] as const)("precedence: %s", (_case, change, reason) => {
    expect(decideInstitutionRegistration({ ...ELIGIBLE, ...change })).toEqual({
      ok: false,
      reason,
    });
  });
});
