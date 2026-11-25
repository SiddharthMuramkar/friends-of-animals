import { describe, expect, it } from "vitest";

import { decideFiling, type FilingTarget } from "./filing";

const self: FilingTarget = { kind: "self" };

function child(
  childAgeYears: number,
  guardian: "verified" | "unverified" | "not_linked" = "verified"
): FilingTarget {
  return { kind: "child", childAgeYears, guardian };
}

describe("decideFiling: for oneself", () => {
  it("lets an adult file every type about their own account", () => {
    for (const type of ["access", "correction", "erasure"] as const) {
      expect(
        decideFiling({ type, requesterAgeYears: 34, target: self })
      ).toEqual({ ok: true, relation: "self", subjectKind: "user" });
    }
  });

  it("treats an account with no date of birth as an adult's", () => {
    expect(
      decideFiling({ type: "erasure", requesterAgeYears: null, target: self })
    ).toEqual({ ok: true, relation: "self", subjectKind: "user" });
  });

  it("lets a 13- to 17-year-old ask for access and correction", () => {
    for (const age of [13, 17]) {
      for (const type of ["access", "correction"] as const) {
        expect(
          decideFiling({ type, requesterAgeYears: age, target: self }).ok
        ).toBe(true);
      }
    }
  });

  it("routes a teen's own erasure request to their guardian", () => {
    expect(
      decideFiling({ type: "erasure", requesterAgeYears: 15, target: self })
    ).toEqual({ ok: false, reason: "erasure_needs_guardian" });
  });

  it("lets an 18-year-old erase their own data", () => {
    expect(
      decideFiling({ type: "erasure", requesterAgeYears: 18, target: self }).ok
    ).toBe(true);
  });

  it("refuses an under-13, who should have no login of their own", () => {
    expect(
      decideFiling({ type: "access", requesterAgeYears: 12, target: self })
    ).toEqual({ ok: false, reason: "under_13_needs_guardian" });
  });
});

describe("decideFiling: a guardian for a child", () => {
  it("lets a verified guardian file every type for a linked child", () => {
    for (const age of [9, 15]) {
      for (const type of ["access", "correction", "erasure"] as const) {
        expect(
          decideFiling({ type, requesterAgeYears: 40, target: child(age) })
        ).toEqual({
          ok: true,
          relation: "guardian",
          subjectKind: "participant_profile",
        });
      }
    }
  });

  it("refuses a child who isn't linked to the requester", () => {
    expect(
      decideFiling({
        type: "access",
        requesterAgeYears: 40,
        target: child(9, "not_linked"),
      })
    ).toEqual({ ok: false, reason: "not_your_child" });
  });

  it("says nothing about the age of someone else's child", () => {
    expect(
      decideFiling({
        type: "access",
        requesterAgeYears: 40,
        target: child(19, "not_linked"),
      })
    ).toEqual({ ok: false, reason: "not_your_child" });
  });

  it("refuses a guardian who hasn't verified yet", () => {
    expect(
      decideFiling({
        type: "erasure",
        requesterAgeYears: 40,
        target: child(9, "unverified"),
      })
    ).toEqual({ ok: false, reason: "guardian_not_verified" });
  });

  it("refuses a child who has turned 18: the adult files for themselves", () => {
    expect(
      decideFiling({ type: "access", requesterAgeYears: 45, target: child(18) })
    ).toEqual({ ok: false, reason: "child_is_adult" });
    expect(
      decideFiling({ type: "access", requesterAgeYears: 45, target: child(17) })
        .ok
    ).toBe(true);
  });
});
