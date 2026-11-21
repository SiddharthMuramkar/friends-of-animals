import { describe, expect, it } from "vitest";

import type { FileStatus } from "../../files/domain/file-status";
import {
  decideReview,
  decideSubmit,
  decideWithdraw,
  REJECTION_NOTE_MAX,
  type FormStatus,
  type ReviewInput,
} from "./review";

const NOW = new Date("2027-01-15T04:30:00.000Z");
const COORDINATOR = "coordinator-1";
const REVIEWER = "staff-admin-1";
const offered = ["public_display", "social_media", "auction"];

const submit = (overrides: Partial<Parameters<typeof decideSubmit>[0]> = {}) =>
  decideSubmit({
    uses: ["public_display"],
    offered,
    fileStatus: "uploaded",
    earlier: [],
    ...overrides,
  });

const review = (
  overrides: {
    status?: FormStatus;
    fileStatus?: FileStatus;
    reviewerId?: string;
  } = {}
): ReviewInput => ({
  form: {
    status: overrides.status ?? "pending_review",
    uploadedBy: COORDINATOR,
  },
  reviewerId: overrides.reviewerId ?? REVIEWER,
  fileStatus: overrides.fileStatus ?? "clean",
  now: NOW,
});

describe("decideSubmit", () => {
  it("takes ticked uses once each, in the offered order", () => {
    expect(submit({ uses: ["auction", "public_display", "auction"] })).toEqual({
      ok: true,
      uses: ["public_display", "auction"],
    });
  });

  it("accepts a scan whose malware check is still running", () => {
    for (const fileStatus of ["uploaded", "scanning", "clean"] as const) {
      expect(submit({ fileStatus }).ok).toBe(true);
    }
  });

  it("needs the scan to be uploaded and not quarantined", () => {
    expect(submit({ fileStatus: "pending_upload" })).toEqual({
      ok: false,
      reason: "file_not_uploaded",
    });
    for (const fileStatus of ["quarantined", "rejected", "deleted"] as const) {
      expect(submit({ fileStatus })).toEqual({
        ok: false,
        reason: "file_unavailable",
      });
    }
  });

  it("refuses uses the competition doesn't offer, participation included", () => {
    expect(submit({ uses: ["public_display", "participation"] })).toEqual({
      ok: false,
      reason: "not_offered",
      uses: ["participation"],
    });
  });

  it("needs at least one ticked use", () => {
    expect(submit({ uses: [] })).toEqual({ ok: false, reason: "no_uses" });
  });

  it("lets one form wait for review at a time", () => {
    expect(submit({ earlier: ["rejected", "pending_review"] })).toEqual({
      ok: false,
      reason: "review_pending",
    });
  });

  it("allows a new form after an accepted, rejected or withdrawn one", () => {
    expect(submit({ earlier: ["accepted", "rejected", "withdrawn"] }).ok).toBe(
      true
    );
  });
});

describe("decideReview: accept", () => {
  it("records the reviewer and the time", () => {
    expect(decideReview(review(), { kind: "accept" })).toEqual({
      ok: true,
      patch: {
        status: "accepted",
        reviewedBy: REVIEWER,
        reviewedAt: NOW,
        rejectionReason: null,
        rejectionNote: null,
      },
    });
  });

  it("needs a scan that passed the malware check", () => {
    for (const fileStatus of [
      "uploaded",
      "scanning",
      "quarantined",
      "rejected",
      "deleted",
    ] as const) {
      expect(decideReview(review({ fileStatus }), { kind: "accept" })).toEqual({
        ok: false,
        reason: "file_not_clean",
      });
    }
  });
});

describe("decideReview: reject", () => {
  it("records the reason and an optional note, trimmed", () => {
    expect(
      decideReview(review({ fileStatus: "quarantined" }), {
        kind: "reject",
        reason: "illegible",
        note: "  Signature box is cut off.  ",
      })
    ).toEqual({
      ok: true,
      patch: {
        status: "rejected",
        reviewedBy: REVIEWER,
        reviewedAt: NOW,
        rejectionReason: "illegible",
        rejectionNote: "Signature box is cut off.",
      },
    });
  });

  it("stores no note when none is given", () => {
    expect(
      decideReview(review(), {
        kind: "reject",
        reason: "not_signed",
        note: " ",
      })
    ).toMatchObject({ ok: true, patch: { rejectionNote: null } });
  });

  it("needs a known reason, and a note for other", () => {
    expect(
      decideReview(review(), { kind: "reject", reason: "because" })
    ).toEqual({ ok: false, reason: "reason_required" });
    expect(decideReview(review(), { kind: "reject", reason: "other" })).toEqual(
      { ok: false, reason: "note_required" }
    );
  });

  it("caps the note", () => {
    const note = "x".repeat(REJECTION_NOTE_MAX + 1);
    expect(
      decideReview(review(), { kind: "reject", reason: "other", note })
    ).toEqual({ ok: false, reason: "note_too_long" });
  });
});

describe("decideReview: who and when", () => {
  it("reviews a form only once", () => {
    for (const status of ["accepted", "rejected", "withdrawn"] as const) {
      expect(decideReview(review({ status }), { kind: "accept" })).toEqual({
        ok: false,
        reason: "not_pending",
      });
    }
  });

  it("never lets the uploader review their own form", () => {
    expect(
      decideReview(review({ reviewerId: COORDINATOR }), { kind: "accept" })
    ).toEqual({ ok: false, reason: "own_upload" });
  });
});

describe("decideWithdraw", () => {
  it("takes back a form waiting for review", () => {
    expect(decideWithdraw({ status: "pending_review" })).toEqual({
      ok: true,
      patch: { status: "withdrawn" },
    });
  });

  it("leaves reviewed and withdrawn forms alone", () => {
    for (const status of ["accepted", "rejected", "withdrawn"] as const) {
      expect(decideWithdraw({ status })).toEqual({
        ok: false,
        reason: "not_pending",
      });
    }
  });
});
