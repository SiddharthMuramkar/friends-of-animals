import { describe, expect, it } from "vitest";

import { checkSecondFactor, isStaffRole, STAFF_ROLES } from "./gate";

const now = new Date("2027-01-15T04:30:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const notEnrolled = { enrolled: false, verifiedAt: null };
const enrolledNotVerified = { enrolled: true, verifiedAt: null };

describe("staff roles", () => {
  it("are the eight FOA staff roles from the ticket", () => {
    expect([...STAFF_ROLES].sort()).toEqual([
      "adoption_coordinator",
      "auction_manager",
      "community_manager",
      "competition_manager",
      "content_manager",
      "finance",
      "staff_admin",
      "super_admin",
    ]);
  });

  it.each([
    "member",
    "participant",
    "guardian",
    "institution_admin",
    "institution_coordinator",
    "judge",
    "volunteer",
    "organisation_representative",
  ])("leave out %s", (role) => {
    expect(isStaffRole(role)).toBe(false);
  });
});

describe("checkSecondFactor for staff screens", () => {
  it("never asks a user without a staff role to enrol", () => {
    expect(
      checkSecondFactor({
        requirement: "staff",
        roles: ["member", "judge", "institution_admin"],
        status: notEnrolled,
        now,
      })
    ).toEqual({ ok: true });
  });

  it.each(STAFF_ROLES)(
    "sends a %s who hasn't enrolled to enrolment",
    (role) => {
      expect(
        checkSecondFactor({
          requirement: "staff",
          roles: ["member", role],
          status: notEnrolled,
          now,
        })
      ).toEqual({ ok: false, code: "enrolment_required" });
    }
  );

  it("asks an enrolled staff user for the second factor in each session", () => {
    expect(
      checkSecondFactor({
        requirement: "staff",
        roles: ["finance"],
        status: enrolledNotVerified,
        now,
      })
    ).toEqual({ ok: false, code: "second_factor_required" });
  });

  it("lets a staff user in once this session passed a second factor", () => {
    expect(
      checkSecondFactor({
        requirement: "staff",
        roles: ["finance"],
        status: { enrolled: true, verifiedAt: ago(11 * 60 * MINUTE) },
        now,
      })
    ).toEqual({ ok: true });
  });
});

describe("checkSecondFactor for step-up", () => {
  const stepUp = (verifiedAt: Date | null, stepUpWindowMs?: number) =>
    checkSecondFactor({
      requirement: "step-up",
      roles: ["super_admin"],
      status: { enrolled: true, verifiedAt },
      now,
      ...(stepUpWindowMs === undefined ? {} : { stepUpWindowMs }),
    });

  it("passes with a second factor 9 min 59 s old", () => {
    expect(stepUp(ago(9 * MINUTE + 59 * SECOND))).toEqual({ ok: true });
  });

  it("passes at exactly 10 minutes", () => {
    expect(stepUp(ago(10 * MINUTE))).toEqual({ ok: true });
  });

  it("refuses a second factor 10 min 1 s old", () => {
    expect(stepUp(ago(10 * MINUTE + SECOND))).toEqual({
      ok: false,
      code: "step_up_required",
    });
  });

  it("refuses a session that never passed a second factor", () => {
    expect(stepUp(null)).toEqual({ ok: false, code: "step_up_required" });
  });

  it("refuses a second factor stamped in the future", () => {
    expect(stepUp(new Date(now.getTime() + SECOND))).toEqual({
      ok: false,
      code: "step_up_required",
    });
  });

  it("follows a shorter window when given one", () => {
    expect(stepUp(ago(2 * MINUTE), MINUTE)).toEqual({
      ok: false,
      code: "step_up_required",
    });
  });

  it("sends anyone without a factor to enrolment first, staff or not", () => {
    for (const roles of [["super_admin"], ["member"]]) {
      expect(
        checkSecondFactor({
          requirement: "step-up",
          roles,
          status: notEnrolled,
          now,
        })
      ).toEqual({ ok: false, code: "enrolment_required" });
    }
  });
});
