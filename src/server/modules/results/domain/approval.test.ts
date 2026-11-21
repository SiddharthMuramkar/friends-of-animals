import { describe, expect, it } from "vitest";

import {
  DELIVERY_NOTE_MAX,
  REJECTION_REASON_MAX,
  decideApproval,
  decideCancel,
  decideDraftEdit,
  decideRejection,
  decideSubmit,
} from "./approval";

const NOW = new Date("2027-02-20T04:30:00.000Z");
const LATER = new Date("2027-03-01T04:30:00.000Z");
const EARLIER = new Date("2027-02-20T04:29:59.000Z");

const PREPARER = "user-preparer";
const SECOND = "user-second";

describe("decideDraftEdit", () => {
  const draft = { status: "draft" as const };

  it("accepts a future publish time and a short note", () => {
    expect(
      decideDraftEdit(
        draft,
        { publishAt: LATER, deliveryNote: "By post." },
        NOW
      )
    ).toEqual({ ok: true });
    expect(
      decideDraftEdit(draft, { publishAt: null, deliveryNote: null }, NOW)
    ).toEqual({ ok: true });
  });

  it("refuses a publish time in the past", () => {
    expect(
      decideDraftEdit(draft, { publishAt: EARLIER, deliveryNote: null }, NOW)
    ).toEqual({ ok: false, reason: "publish_at_past" });
  });

  it("refuses a delivery note over the limit, and accepts one at it", () => {
    expect(
      decideDraftEdit(
        draft,
        { publishAt: null, deliveryNote: "x".repeat(DELIVERY_NOTE_MAX + 1) },
        NOW
      )
    ).toEqual({ ok: false, reason: "delivery_note_too_long" });
    expect(
      decideDraftEdit(
        draft,
        { publishAt: null, deliveryNote: "x".repeat(DELIVERY_NOTE_MAX) },
        NOW
      )
    ).toEqual({ ok: true });
  });

  it.each(["pending_approval", "approved", "published", "rejected"] as const)(
    "refuses to edit a %s release",
    (status) => {
      expect(
        decideDraftEdit(
          { status },
          { publishAt: LATER, deliveryNote: null },
          NOW
        )
      ).toEqual({ ok: false, reason: "not_draft" });
    }
  );
});

describe("decideSubmit", () => {
  const draft = {
    status: "draft" as const,
    preparedBy: PREPARER,
    publishAt: LATER,
  };

  it("lets the preparer submit a draft with a future publish time", () => {
    expect(decideSubmit(draft, PREPARER, NOW)).toEqual({ ok: true });
  });

  it("refuses anyone but the preparer", () => {
    expect(decideSubmit(draft, SECOND, NOW)).toEqual({
      ok: false,
      reason: "not_preparer",
    });
  });

  it("needs a publish time, still in the future", () => {
    expect(decideSubmit({ ...draft, publishAt: null }, PREPARER, NOW)).toEqual({
      ok: false,
      reason: "publish_at_missing",
    });
    expect(
      decideSubmit({ ...draft, publishAt: EARLIER }, PREPARER, NOW)
    ).toEqual({ ok: false, reason: "publish_at_past" });
  });

  it("refuses a release that is not a draft", () => {
    expect(
      decideSubmit({ ...draft, status: "pending_approval" }, PREPARER, NOW)
    ).toEqual({ ok: false, reason: "not_draft" });
  });
});

describe("decideApproval", () => {
  const pending = {
    status: "pending_approval" as const,
    preparedBy: PREPARER,
    storedHash: "a".repeat(64),
    contentHash: "a".repeat(64),
    linesHash: "c".repeat(64),
  };
  const liveLinesHash = "c".repeat(64);

  it("lets a second person approve", () => {
    expect(decideApproval(pending, liveLinesHash, SECOND)).toEqual({
      ok: true,
    });
  });

  it("never lets the preparer approve their own results", () => {
    expect(decideApproval(pending, liveLinesHash, PREPARER)).toEqual({
      ok: false,
      reason: "own_results",
    });
  });

  it("refuses a release that is not waiting for approval", () => {
    for (const status of [
      "draft",
      "approved",
      "published",
      "rejected",
    ] as const)
      expect(
        decideApproval({ ...pending, status }, liveLinesHash, SECOND)
      ).toEqual({ ok: false, reason: "not_pending" });
  });

  it("refuses a release whose stored content was changed after it was prepared", () => {
    expect(
      decideApproval(
        { ...pending, contentHash: "b".repeat(64) },
        liveLinesHash,
        SECOND
      )
    ).toEqual({ ok: false, reason: "stale_snapshot" });
  });

  it("refuses when the round's outcomes changed since the snapshot", () => {
    expect(decideApproval(pending, "d".repeat(64), SECOND)).toEqual({
      ok: false,
      reason: "round_changed",
    });
  });

  it("checks the two-person rule before anything else", () => {
    expect(
      decideApproval(
        { ...pending, contentHash: "b".repeat(64) },
        "d".repeat(64),
        PREPARER
      )
    ).toEqual({ ok: false, reason: "own_results" });
  });
});

describe("decideRejection", () => {
  const pending = { status: "pending_approval" as const, preparedBy: PREPARER };

  it("lets a second person reject with a reason", () => {
    expect(decideRejection(pending, SECOND, "Wrong age group.")).toEqual({
      ok: true,
      reason: "Wrong age group.",
    });
  });

  it("trims the reason and needs one", () => {
    expect(decideRejection(pending, SECOND, "  Typo.  ")).toEqual({
      ok: true,
      reason: "Typo.",
    });
    expect(decideRejection(pending, SECOND, "   ")).toEqual({
      ok: false,
      reason: "reason_required",
    });
  });

  it("caps the reason", () => {
    expect(
      decideRejection(pending, SECOND, "x".repeat(REJECTION_REASON_MAX + 1))
    ).toEqual({ ok: false, reason: "reason_too_long" });
  });

  it("never lets the preparer reject their own results", () => {
    expect(decideRejection(pending, PREPARER, "Changed my mind.")).toEqual({
      ok: false,
      reason: "own_results",
    });
  });

  it("refuses a release that is not waiting for approval", () => {
    expect(
      decideRejection({ ...pending, status: "approved" }, SECOND, "Late.")
    ).toEqual({ ok: false, reason: "not_pending" });
  });
});

describe("decideCancel", () => {
  it("stops an approved release that has not been published", () => {
    expect(
      decideCancel({ status: "approved" }, "Prize text is wrong.")
    ).toEqual({ ok: true, reason: "Prize text is wrong." });
  });

  it("needs a reason", () => {
    expect(decideCancel({ status: "approved" }, "")).toEqual({
      ok: false,
      reason: "reason_required",
    });
  });

  it.each(["draft", "pending_approval", "published", "rejected"] as const)(
    "refuses to cancel a %s release",
    (status) => {
      expect(decideCancel({ status }, "Stop.")).toEqual({
        ok: false,
        reason: "not_approved",
      });
    }
  );
});
