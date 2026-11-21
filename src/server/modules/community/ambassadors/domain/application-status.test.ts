import { describe, expect, it } from "vitest";

import {
  AMBASSADOR_APPLICATION_STATUSES,
  AMBASSADOR_DECISIONS,
  type AmbassadorApplicationStatus,
  type AmbassadorDecision,
  allowedDecisions,
  decideAmbassadorApplication,
  DECISION_REASON_MAX_LENGTH,
  isOpenApplication,
} from "./application-status";

/** Every allowed move; any pair not listed here must be refused. */
const ALLOWED: Record<string, AmbassadorApplicationStatus> = {
  "submitted:approve": "approved",
  "submitted:decline": "declined",
  "submitted:withdraw": "withdrawn",
};

const decide = (
  from: AmbassadorApplicationStatus,
  decision: AmbassadorDecision,
  extra: { reason?: string; eligibleNow?: boolean } = {}
) =>
  decideAmbassadorApplication({
    from,
    decision,
    reason: extra.reason ?? (decision === "decline" ? "Not this year" : ""),
    eligibleNow: extra.eligibleNow ?? true,
  });

describe("the ambassador application transition table", () => {
  const pairs = AMBASSADOR_APPLICATION_STATUSES.flatMap((from) =>
    AMBASSADOR_DECISIONS.map((decision) => ({ from, decision }))
  );

  it.each(pairs)("$from + $decision", ({ from, decision }) => {
    const to = ALLOWED[`${from}:${decision}`];
    const result = decide(from, decision);
    if (to === undefined) {
      expect(result).toEqual({ ok: false, error: "transition_not_allowed" });
    } else {
      expect(result).toMatchObject({ ok: true, to });
    }
  });

  it("lists the decisions each status allows", () => {
    expect(allowedDecisions("submitted")).toEqual([
      "approve",
      "decline",
      "withdraw",
    ]);
    expect(allowedDecisions("approved")).toEqual([]);
    expect(allowedDecisions("declined")).toEqual([]);
    expect(allowedDecisions("withdrawn")).toEqual([]);
  });

  it("treats only a submitted application as open", () => {
    expect(
      AMBASSADOR_APPLICATION_STATUSES.filter((status) =>
        isOpenApplication(status)
      )
    ).toEqual(["submitted"]);
  });
});

describe("approving", () => {
  it("records the ambassador milestone and tells the applicant", () => {
    expect(decide("submitted", "approve")).toEqual({
      ok: true,
      to: "approved",
      recordsMilestone: true,
      notifiesApplicant: true,
      reason: null,
    });
  });

  it("is refused when the applicant is no longer eligible", () => {
    expect(decide("submitted", "approve", { eligibleNow: false })).toEqual({
      ok: false,
      error: "no_longer_eligible",
    });
  });

  it("reports a closed application before eligibility", () => {
    expect(decide("approved", "approve", { eligibleNow: false })).toEqual({
      ok: false,
      error: "transition_not_allowed",
    });
  });

  it("ignores a reason", () => {
    expect(decide("submitted", "approve", { reason: "Great work" })).toEqual(
      expect.objectContaining({ ok: true, reason: null })
    );
  });
});

describe("declining", () => {
  it("needs a reason", () => {
    expect(decide("submitted", "decline", { reason: "" })).toEqual({
      ok: false,
      error: "reason_required",
    });
    expect(decide("submitted", "decline", { reason: " \n\t " })).toEqual({
      ok: false,
      error: "reason_required",
    });
  });

  it("keeps the reason trimmed and tells the applicant", () => {
    expect(
      decide("submitted", "decline", { reason: "  Join an event first.\n" })
    ).toEqual({
      ok: true,
      to: "declined",
      recordsMilestone: false,
      notifiesApplicant: true,
      reason: "Join an event first.",
    });
  });

  it(`allows up to ${DECISION_REASON_MAX_LENGTH} characters`, () => {
    const longest = "a".repeat(DECISION_REASON_MAX_LENGTH);
    expect(decide("submitted", "decline", { reason: longest })).toEqual(
      expect.objectContaining({ ok: true, reason: longest })
    );
    expect(decide("submitted", "decline", { reason: `${longest}a` })).toEqual({
      ok: false,
      error: "reason_too_long",
    });
  });

  it("counts an emoji as one character", () => {
    const emoji = "🐾".repeat(DECISION_REASON_MAX_LENGTH);
    expect(decide("submitted", "decline", { reason: emoji })).toEqual(
      expect.objectContaining({ ok: true })
    );
  });

  it("does not depend on the applicant's eligibility", () => {
    expect(
      decide("submitted", "decline", { eligibleNow: false })
    ).toMatchObject({ ok: true, to: "declined" });
  });
});

describe("withdrawing", () => {
  it("closes the application quietly, with no milestone", () => {
    expect(decide("submitted", "withdraw", { eligibleNow: false })).toEqual({
      ok: true,
      to: "withdrawn",
      recordsMilestone: false,
      notifiesApplicant: false,
      reason: null,
    });
  });
});
