import { describe, expect, it } from "vitest";

import {
  allowedOutcomes,
  BATCH_STATUSES_BEFORE_REVIEW,
  characterCount,
  PAYMENT_REVIEW_OUTCOMES,
  PAYMENT_REVIEW_REASONS,
  planResolution,
  RESOLUTION_REASON_MAX_LENGTH,
  RESOLUTION_REASON_MIN_LENGTH,
  reviewReasonFor,
  type BatchStatusBeforeReview,
  type PaymentReviewOutcome,
  type PaymentReviewReason,
  type RegistrationAtCapture,
} from "./review-case";

const payable: RegistrationAtCapture = {
  registrationId: "r1",
  standing: "awaiting_payment",
  windowOpen: true,
  heldByThisBatch: true,
};

const reg = (patch: Partial<RegistrationAtCapture>, id = "r1") => ({
  ...payable,
  registrationId: id,
  ...patch,
});

describe("reviewReasonFor()", () => {
  it("accepts a capture of the right amount for registrations this batch holds and that still await payment", () => {
    expect(
      reviewReasonFor({
        amountMatches: true,
        registrations: [reg({}, "r1"), reg({}, "r2")],
      })
    ).toBeNull();
  });

  it.each<[string, Partial<RegistrationAtCapture>, PaymentReviewReason]>([
    ["already paid", { standing: "paid" }, "already_paid"],
    [
      "withdrawn or cancelled",
      { standing: "cancelled" },
      "registration_cancelled",
    ],
    [
      "past its competition's registration close",
      { windowOpen: false },
      "registration_closed",
    ],
    ["held by a newer batch", { heldByThisBatch: false }, "batch_superseded"],
  ])("sends a capture for a registration %s to review", (_, patch, reason) => {
    expect(
      reviewReasonFor({
        amountMatches: true,
        registrations: [reg({}, "r1"), reg(patch, "r2")],
      })
    ).toBe(reason);
  });

  it("sends a capture for the wrong amount to review", () => {
    expect(
      reviewReasonFor({ amountMatches: false, registrations: [payable] })
    ).toBe("amount_mismatch");
  });

  it("names the first reason in precedence order when several apply", () => {
    const everything = [
      reg({ heldByThisBatch: false }, "a"),
      reg({ windowOpen: false }, "b"),
      reg({ standing: "cancelled" }, "c"),
      reg({ standing: "paid" }, "d"),
    ];
    expect(
      reviewReasonFor({ amountMatches: false, registrations: everything })
    ).toBe("already_paid");
    expect(
      reviewReasonFor({
        amountMatches: false,
        registrations: everything.slice(0, 3),
      })
    ).toBe("registration_cancelled");
    expect(
      reviewReasonFor({
        amountMatches: false,
        registrations: everything.slice(0, 2),
      })
    ).toBe("amount_mismatch");
    expect(
      reviewReasonFor({
        amountMatches: true,
        registrations: everything.slice(0, 2),
      })
    ).toBe("registration_closed");
  });

  it("lists the reasons in that precedence order", () => {
    expect(PAYMENT_REVIEW_REASONS).toEqual([
      "already_paid",
      "registration_cancelled",
      "amount_mismatch",
      "registration_closed",
      "batch_superseded",
      "paid_while_in_review",
      "participation_consent_required",
      "donation_expired",
    ]);
  });

  it("sends a capture for a batch with nothing left to confirm to review", () => {
    expect(reviewReasonFor({ amountMatches: true, registrations: [] })).toBe(
      "batch_superseded"
    );
  });
});

describe("allowedOutcomes()", () => {
  const CONFIRMABLE: readonly PaymentReviewReason[] = [
    "amount_mismatch",
    "registration_closed",
    "batch_superseded",
    // #80, from #79's review: a full payment while another was in review.
    "paid_while_in_review",
    "participation_consent_required",
  ];

  it.each(
    PAYMENT_REVIEW_REASONS.flatMap((reason) =>
      BATCH_STATUSES_BEFORE_REVIEW.map((before) => [reason, before] as const)
    )
  )("for %s on a batch that was %s", (reason, before) => {
    const confirmable = CONFIRMABLE.includes(reason) && before !== "captured";
    expect(
      allowedOutcomes({
        reason,
        batchStatusBefore: before,
        currency: "INR",
        amountMinor: 100n,
      })
    ).toEqual(confirmable ? ["confirm", "refund", "keep"] : ["refund", "keep"]);
  });

  it("never offers confirm for a reason ranked above the confirmable ones", () => {
    for (const [index, reason] of PAYMENT_REVIEW_REASONS.entries()) {
      expect(
        allowedOutcomes({
          reason,
          batchStatusBefore: "cancelled",
          currency: "INR",
          amountMinor: 100n,
        }).includes("confirm")
      ).toBe(index >= 2 && reason !== "donation_expired");
    }
  });

  it("offers a donation's batch confirm only for late money on an expired donation (#106)", () => {
    for (const reason of PAYMENT_REVIEW_REASONS) {
      expect(
        allowedOutcomes({
          reason,
          batchStatusBefore: "cancelled",
          currency: "INR",
          amountMinor: 100n,
          purpose: "donation",
        }),
        reason
      ).toEqual(
        reason === "donation_expired"
          ? ["confirm", "refund", "keep"]
          : ["refund", "keep"]
      );
    }
  });
});

describe("planResolution()", () => {
  const note = "Payer confirmed by phone they paid twice by mistake.";
  const open = (
    reason: PaymentReviewReason,
    batchStatusBefore: BatchStatusBeforeReview
  ) => ({
    reason,
    batchStatusBefore,
    resolvedAt: null,
    currency: "INR",
    amountMinor: 100n,
  });
  const plan = (
    reviewCase: ReturnType<typeof open>,
    outcome: PaymentReviewOutcome,
    otherOpenCases = 0,
    resolutionReason = note
  ) =>
    planResolution({ reviewCase, outcome, resolutionReason, otherOpenCases });

  it("confirms the registrations and captures the batch on confirm", () => {
    expect(
      plan(open("registration_closed", "order_created"), "confirm")
    ).toEqual({
      ok: true,
      outcome: "confirm",
      resolutionReason: note,
      batchEvent: "review_confirmed",
      confirmsRegistrations: true,
      refundDue: false,
    });
  });

  it.each<[BatchStatusBeforeReview, PaymentReviewOutcome, string, boolean]>([
    ["captured", "refund", "review_cleared", true],
    ["captured", "keep", "review_cleared", false],
    ["order_created", "refund", "review_dismissed", true],
    ["cancelled", "refund", "review_dismissed", true],
    ["failed", "keep", "review_dismissed", false],
    ["created", "keep", "review_dismissed", false],
  ])(
    "on a batch that was %s, %s gives %s (refund due: %s)",
    (before, outcome, batchEvent, refundDue) => {
      expect(plan(open("already_paid", before), outcome)).toEqual({
        ok: true,
        outcome,
        resolutionReason: note,
        batchEvent,
        confirmsRegistrations: false,
        refundDue,
      });
    }
  );

  it("leaves the batch in review while another case on it is open", () => {
    expect(plan(open("already_paid", "captured"), "refund", 1)).toMatchObject({
      ok: true,
      batchEvent: null,
      refundDue: true,
    });
  });

  it("refuses confirm while another case on the batch is open", () => {
    expect(
      plan(open("registration_closed", "cancelled"), "confirm", 1)
    ).toEqual({ ok: false, refusal: "resolve_other_cases_first" });
  });

  it("refuses an outcome the case doesn't allow", () => {
    expect(plan(open("already_paid", "cancelled"), "confirm")).toEqual({
      ok: false,
      refusal: "outcome_not_allowed",
    });
    expect(plan(open("amount_mismatch", "captured"), "confirm")).toEqual({
      ok: false,
      refusal: "outcome_not_allowed",
    });
  });

  it("refuses a case that is already resolved", () => {
    expect(
      planResolution({
        reviewCase: {
          ...open("already_paid", "captured"),
          resolvedAt: new Date("2027-01-15T04:30:00.000Z"),
        },
        outcome: "refund",
        resolutionReason: note,
        otherOpenCases: 0,
      })
    ).toEqual({ ok: false, refusal: "already_resolved" });
  });

  it.each(["", "   ", "\n\t", "too short"])(
    "refuses resolution reason %j: say why in a sentence",
    (resolutionReason) => {
      expect(
        plan(open("already_paid", "captured"), "keep", 0, resolutionReason)
      ).toEqual({ ok: false, refusal: "reason_required" });
    }
  );

  it("counts characters as a reader does, not code points or bytes", () => {
    expect(characterCount("हु")).toBe(1);
    expect(characterCount("दो बार")).toBe(4);
    // Ten characters (भु ग ता न, space, दो, space, बा र, ।) but 14 code points.
    const ten = "भुगतान दो बार।";
    expect(characterCount(ten)).toBe(RESOLUTION_REASON_MIN_LENGTH);
    expect(
      plan(open("already_paid", "captured"), "keep", 0, ten)
    ).toMatchObject({ ok: true });
    expect(
      plan(open("already_paid", "captured"), "keep", 0, "भुगतान दो बार")
    ).toEqual({ ok: false, refusal: "reason_required" });
  });

  it(`takes ${RESOLUTION_REASON_MIN_LENGTH} to ${RESOLUTION_REASON_MAX_LENGTH} characters after trimming`, () => {
    const atMin = "Paid twice.";
    expect(
      plan(open("already_paid", "captured"), "keep", 0, `  ${atMin}  `)
    ).toMatchObject({ ok: true, resolutionReason: atMin });

    const atMax = "a".repeat(RESOLUTION_REASON_MAX_LENGTH);
    expect(plan(open("already_paid", "captured"), "keep", 0, atMax).ok).toBe(
      true
    );
    expect(
      plan(open("already_paid", "captured"), "keep", 0, `${atMax}a`)
    ).toEqual({ ok: false, refusal: "reason_too_long" });
  });

  it("covers every outcome", () => {
    expect(PAYMENT_REVIEW_OUTCOMES).toEqual(["confirm", "refund", "keep"]);
  });
});
