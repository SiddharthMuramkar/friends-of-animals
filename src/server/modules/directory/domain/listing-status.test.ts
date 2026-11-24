import { describe, expect, it } from "vitest";

import {
  allowedStaffActions,
  canEdit,
  canWithdraw,
  decideListingStatus,
  INITIAL_LISTING_STATUS,
  isPubliclyListed,
  LISTING_ACTIONS,
  LISTING_STATUSES,
  STATUS_REASON_MAX_LENGTH,
} from "./listing-status";

const REASON = "Checked the trust deed and the AWBI letter";

describe("listing status transitions", () => {
  // Every status against every action. Pairs not listed here are refused.
  const allowed = {
    "pending_verification verify": {
      to: "verified",
      outcome: "verified",
      event: "directory.listing_verified",
      grantsRepresentative: true,
    },
    "pending_verification reject": {
      to: "rejected",
      outcome: "rejected",
      event: "directory.listing_rejected",
      grantsRepresentative: false,
    },
    "pending_verification withdraw": {
      to: "withdrawn",
      outcome: "withdrawn",
      event: null,
      grantsRepresentative: false,
    },
    "pending_verification edit_details": {
      to: "pending_verification",
      outcome: "edited",
      event: null,
      grantsRepresentative: false,
    },
    "pending_verification edit_identity": {
      to: "pending_verification",
      outcome: "edited",
      event: null,
      grantsRepresentative: false,
    },
    "verified suspend": {
      to: "suspended",
      outcome: "suspended",
      event: "directory.listing_suspended",
      grantsRepresentative: false,
    },
    "verified withdraw": {
      to: "withdrawn",
      outcome: "withdrawn",
      event: null,
      grantsRepresentative: false,
    },
    "verified edit_details": {
      to: "verified",
      outcome: "edited",
      event: null,
      grantsRepresentative: false,
    },
    "verified edit_identity": {
      to: "pending_verification",
      outcome: "resubmitted",
      event: "directory.listing_submitted",
      grantsRepresentative: false,
    },
    "suspended reinstate": {
      to: "verified",
      outcome: "reinstated",
      event: "directory.listing_reinstated",
      grantsRepresentative: false,
    },
  } as const;

  const table = LISTING_STATUSES.flatMap((from) =>
    LISTING_ACTIONS.map((action) => ({ from, action }))
  );

  it("covers five statuses and seven actions", () => {
    expect(LISTING_STATUSES).toEqual([
      "pending_verification",
      "verified",
      "rejected",
      "suspended",
      "withdrawn",
    ]);
    expect(LISTING_ACTIONS).toEqual([
      "verify",
      "reject",
      "suspend",
      "reinstate",
      "withdraw",
      "edit_details",
      "edit_identity",
    ]);
    expect(table).toHaveLength(35);
  });

  it.each(table)("$from + $action", ({ from, action }) => {
    const expected = allowed[`${from} ${action}` as keyof typeof allowed];
    const result = decideListingStatus({ from, action, reason: REASON });
    if (expected) {
      expect(result).toMatchObject({ ok: true, ...expected });
    } else {
      expect(result).toEqual({ ok: false, error: "transition_not_allowed" });
    }
  });

  it("starts every listing pending verification", () => {
    expect(INITIAL_LISTING_STATUS).toBe("pending_verification");
  });

  it("refuses a disallowed move before looking at the reason", () => {
    expect(
      decideListingStatus({ from: "rejected", action: "verify", reason: "" })
    ).toEqual({ ok: false, error: "transition_not_allowed" });
  });
});

describe("the reason for a staff decision", () => {
  const staffMoves = [
    { from: "pending_verification", action: "verify" },
    { from: "pending_verification", action: "reject" },
    { from: "verified", action: "suspend" },
    { from: "suspended", action: "reinstate" },
  ] as const;

  it.each(staffMoves)("is required to $action", ({ from, action }) => {
    for (const reason of ["", "   ", "\n\t"]) {
      expect(decideListingStatus({ from, action, reason })).toEqual({
        ok: false,
        error: "reason_required",
      });
    }
    expect(decideListingStatus({ from, action })).toEqual({
      ok: false,
      error: "reason_required",
    });
  });

  it("is trimmed and kept", () => {
    expect(
      decideListingStatus({
        from: "verified",
        action: "suspend",
        reason: "  Complaint about animal welfare under review  ",
      })
    ).toMatchObject({
      ok: true,
      reason: "Complaint about animal welfare under review",
    });
  });

  it("may be 1000 characters but not 1001", () => {
    expect(STATUS_REASON_MAX_LENGTH).toBe(1000);
    expect(
      decideListingStatus({
        from: "pending_verification",
        action: "reject",
        reason: "x".repeat(1000),
      })
    ).toMatchObject({ ok: true });
    expect(
      decideListingStatus({
        from: "pending_verification",
        action: "reject",
        reason: ` ${"x".repeat(1001)} `,
      })
    ).toEqual({ ok: false, error: "reason_too_long" });
  });
});

describe("the reason for the listing's own actions", () => {
  it("is optional when withdrawing, and kept when given", () => {
    expect(
      decideListingStatus({ from: "verified", action: "withdraw" })
    ).toMatchObject({ ok: true, to: "withdrawn", reason: null });
    expect(
      decideListingStatus({
        from: "verified",
        action: "withdraw",
        reason: "   ",
      })
    ).toMatchObject({ ok: true, reason: null });
    expect(
      decideListingStatus({
        from: "pending_verification",
        action: "withdraw",
        reason: " We have closed down ",
      })
    ).toMatchObject({ ok: true, reason: "We have closed down" });
  });

  it("is still capped when withdrawing", () => {
    expect(
      decideListingStatus({
        from: "verified",
        action: "withdraw",
        reason: "x".repeat(1001),
      })
    ).toEqual({ ok: false, error: "reason_too_long" });
  });

  it("is not recorded for edits", () => {
    expect(
      decideListingStatus({
        from: "verified",
        action: "edit_identity",
        reason: "ignored",
      })
    ).toMatchObject({ ok: true, reason: null });
  });
});

describe("public visibility", () => {
  it("lists only verified listings", () => {
    expect(LISTING_STATUSES.filter(isPubliclyListed)).toEqual(["verified"]);
  });
});

describe("what each status lets people do", () => {
  it("offers staff only the decisions the table allows", () => {
    expect(allowedStaffActions("pending_verification")).toEqual([
      "verify",
      "reject",
    ]);
    expect(allowedStaffActions("verified")).toEqual(["suspend"]);
    expect(allowedStaffActions("suspended")).toEqual(["reinstate"]);
    expect(allowedStaffActions("rejected")).toEqual([]);
    expect(allowedStaffActions("withdrawn")).toEqual([]);
  });

  it("lets the listing's people edit and withdraw only a pending or verified listing", () => {
    expect(LISTING_STATUSES.filter(canEdit)).toEqual([
      "pending_verification",
      "verified",
    ]);
    expect(LISTING_STATUSES.filter(canWithdraw)).toEqual([
      "pending_verification",
      "verified",
    ]);
  });
});
