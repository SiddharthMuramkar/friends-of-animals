import { describe, expect, it } from "vitest";

import {
  decide,
  RESUBMISSION_DAYS,
  SEND_BACK_REASON_CODES,
  SEND_BACK_REASON_TEXT_MAX,
  type VerificationCommand,
  type VerificationState,
} from "./decide";

const NOW = new Date("2027-03-01T04:30:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const awaiting: VerificationState = {
  status: "submitted_to_foa",
  resubmissionDueAt: null,
  resubmissionPending: false,
};
const verified: VerificationState = {
  status: "foa_verified",
  resubmissionDueAt: null,
  resubmissionPending: false,
};
const sentBack = (
  dueAt: Date,
  resubmissionPending = false
): VerificationState => ({
  status: "sent_back",
  resubmissionDueAt: dueAt,
  resubmissionPending,
});
const otherStatus = (status: string): VerificationState => ({
  status,
  resubmissionDueAt: null,
  resubmissionPending: false,
});

const verify: VerificationCommand = { kind: "verify" };
const sendBack = (
  reason: { code?: unknown; text?: unknown },
  resubmissionDays: number = RESUBMISSION_DAYS.default
): VerificationCommand => ({ kind: "send_back", reason, resubmissionDays });

const STATUSES_BEFORE_FOA = [
  "processing",
  "submitted",
  "rejected",
  "failed",
  "school_shortlisted",
  "not_shortlisted",
];

describe("verifying an entry", () => {
  it("verifies an entry waiting for verification", () => {
    expect(decide(awaiting, verify, NOW)).toEqual({
      ok: true,
      to: "foa_verified",
      event: "entry.foa_verified",
    });
  });

  it("refuses an entry that is already verified", () => {
    expect(decide(verified, verify, NOW)).toEqual({
      ok: false,
      code: "already_verified",
    });
  });

  it("refuses a sent-back entry until it is resubmitted", () => {
    const due = new Date(NOW.getTime() + DAY);
    expect(decide(sentBack(due), verify, NOW)).toEqual({
      ok: false,
      code: "awaiting_resubmission",
    });
  });

  it.each(STATUSES_BEFORE_FOA)(
    "refuses an entry that is %s, which has not reached FOA",
    (status) => {
      expect(decide(otherStatus(status), verify, NOW)).toEqual({
        ok: false,
        code: "not_awaiting_verification",
      });
    }
  );
});

describe("sending an entry back", () => {
  it("sends it back with a preset reason and a deadline 7 days out", () => {
    expect(
      decide(awaiting, sendBack({ code: "file_unreadable" }), NOW)
    ).toEqual({
      ok: true,
      to: "sent_back",
      event: "entry.sent_back",
      reason: { code: "file_unreadable", text: null },
      resubmissionDueAt: new Date("2027-03-08T04:30:00.000Z"),
    });
  });

  it("uses the resubmission days it is given", () => {
    const decision = decide(awaiting, sendBack({ code: "wrong_work" }, 3), NOW);
    expect(decision).toMatchObject({
      ok: true,
      resubmissionDueAt: new Date("2027-03-04T04:30:00.000Z"),
    });
  });

  it("keeps a trimmed note next to a preset reason", () => {
    const decision = decide(
      awaiting,
      sendBack({ code: "missing_declaration", text: "  Page 2 is unsigned. " }),
      NOW
    );
    expect(decision).toMatchObject({
      ok: true,
      reason: { code: "missing_declaration", text: "Page 2 is unsigned." },
    });
  });

  it("drops a blank note next to a preset reason", () => {
    const decision = decide(
      awaiting,
      sendBack({ code: "wrong_work", text: "   " }),
      NOW
    );
    expect(decision).toMatchObject({
      ok: true,
      reason: { code: "wrong_work", text: null },
    });
  });

  it("refuses without a reason", () => {
    expect(decide(awaiting, sendBack({}), NOW)).toEqual({
      ok: false,
      code: "reason_required",
    });
  });

  it.each([["made_up"], [""], [42], [null]])(
    "refuses an unknown reason code %j",
    (code) => {
      expect(decide(awaiting, sendBack({ code }), NOW)).toEqual({
        ok: false,
        code: "reason_required",
      });
    }
  );

  it("refuses 'other' without words saying what is wrong", () => {
    expect(decide(awaiting, sendBack({ code: "other" }), NOW)).toEqual({
      ok: false,
      code: "reason_text_required",
    });
    expect(
      decide(awaiting, sendBack({ code: "other", text: " \n " }), NOW)
    ).toEqual({ ok: false, code: "reason_text_required" });
  });

  it("accepts 'other' with words", () => {
    const decision = decide(
      awaiting,
      sendBack({ code: "other", text: "The photo is upside down." }),
      NOW
    );
    expect(decision).toMatchObject({
      ok: true,
      reason: { code: "other", text: "The photo is upside down." },
    });
  });

  it("refuses a note longer than the limit", () => {
    const text = "a".repeat(SEND_BACK_REASON_TEXT_MAX + 1);
    expect(decide(awaiting, sendBack({ code: "other", text }), NOW)).toEqual({
      ok: false,
      code: "reason_text_too_long",
    });
    const atLimit = "a".repeat(SEND_BACK_REASON_TEXT_MAX);
    expect(
      decide(awaiting, sendBack({ code: "other", text: atLimit }), NOW)
    ).toMatchObject({ ok: true });
  });

  it("refuses a note that is not text", () => {
    expect(
      decide(awaiting, sendBack({ code: "wrong_work", text: 7 }), NOW)
    ).toEqual({ ok: false, code: "reason_required" });
  });

  it("refuses an entry that is already verified", () => {
    expect(decide(verified, sendBack({ code: "wrong_work" }), NOW)).toEqual({
      ok: false,
      code: "already_verified",
    });
  });

  it("refuses an entry that is already sent back", () => {
    const due = new Date(NOW.getTime() + DAY);
    expect(
      decide(sentBack(due), sendBack({ code: "wrong_work" }), NOW)
    ).toEqual({ ok: false, code: "awaiting_resubmission" });
  });

  it.each(STATUSES_BEFORE_FOA)(
    "refuses an entry that is %s, which has not reached FOA",
    (status) => {
      expect(
        decide(otherStatus(status), sendBack({ code: "wrong_work" }), NOW)
      ).toEqual({ ok: false, code: "not_awaiting_verification" });
    }
  );

  it.each([0, -1, 1.5, Number.NaN, RESUBMISSION_DAYS.max + 1])(
    "throws on resubmission days %s, which the setting never allows",
    (days) => {
      expect(() =>
        decide(awaiting, sendBack({ code: "wrong_work" }, days), NOW)
      ).toThrow(RangeError);
    }
  );

  it("offers the preset reasons in a fixed order, 'other' last", () => {
    expect(SEND_BACK_REASON_CODES).toEqual([
      "file_unreadable",
      "wrong_work",
      "missing_declaration",
      "other",
    ]);
  });
});

describe("resubmitting a sent-back entry", () => {
  const due = new Date(NOW.getTime() + 7 * DAY);

  it("returns it to the queue at once when no new file is needed", () => {
    expect(
      decide(sentBack(due), { kind: "resubmit", withNewFile: false }, NOW)
    ).toEqual({
      ok: true,
      to: "submitted_to_foa",
      event: "entry.resubmitted",
    });
  });

  it("keeps it sent back while a new file is being checked", () => {
    expect(
      decide(sentBack(due), { kind: "resubmit", withNewFile: true }, NOW)
    ).toEqual({ ok: true, to: null, event: null });
  });

  it("returns it to the queue once the new file is live", () => {
    expect(
      decide(sentBack(due, true), { kind: "replacement_live" }, NOW)
    ).toEqual({
      ok: true,
      to: "submitted_to_foa",
      event: "entry.resubmitted",
    });
  });

  it("still returns it once the file is live after the deadline, as it was resubmitted in time", () => {
    const afterDeadline = new Date(due.getTime() + DAY);
    expect(
      decide(sentBack(due, true), { kind: "replacement_live" }, afterDeadline)
    ).toMatchObject({ ok: true, to: "submitted_to_foa" });
  });

  it("ignores a live file when no resubmission is pending", () => {
    expect(decide(sentBack(due), { kind: "replacement_live" }, NOW)).toEqual({
      ok: false,
      code: "no_resubmission_pending",
    });
    expect(decide(awaiting, { kind: "replacement_live" }, NOW)).toEqual({
      ok: false,
      code: "no_resubmission_pending",
    });
  });

  it("allows a resubmission up to just before the deadline", () => {
    const justBefore = new Date(due.getTime() - 1);
    expect(
      decide(
        sentBack(due),
        { kind: "resubmit", withNewFile: false },
        justBefore
      )
    ).toMatchObject({ ok: true });
  });

  it("refuses a resubmission at or after the deadline, and the entry stays sent back", () => {
    for (const at of [due, new Date(due.getTime() + DAY)]) {
      for (const withNewFile of [false, true]) {
        expect(
          decide(sentBack(due), { kind: "resubmit", withNewFile }, at)
        ).toEqual({ ok: false, code: "resubmission_closed" });
      }
    }
  });

  it("refuses an entry that is already verified", () => {
    expect(
      decide(verified, { kind: "resubmit", withNewFile: false }, NOW)
    ).toEqual({ ok: false, code: "already_verified" });
  });

  it.each(["submitted_to_foa", ...STATUSES_BEFORE_FOA])(
    "refuses an entry that is %s, which was not sent back",
    (status) => {
      expect(
        decide(
          otherStatus(status),
          { kind: "resubmit", withNewFile: true },
          NOW
        )
      ).toEqual({ ok: false, code: "not_sent_back" });
    }
  );

  it("throws when a sent-back entry has no deadline, which the schema never allows", () => {
    const broken: VerificationState = {
      status: "sent_back",
      resubmissionDueAt: null,
      resubmissionPending: false,
    };
    expect(() =>
      decide(broken, { kind: "resubmit", withNewFile: false }, NOW)
    ).toThrow(TypeError);
  });
});

describe("forwarding an individual entry to FOA", () => {
  const closesAt = new Date("2027-02-28T18:29:59.000Z");
  const forward = (
    route: "school" | "individual",
    submissionClosesAt: Date = closesAt
  ): VerificationCommand => ({ kind: "forward", route, submissionClosesAt });

  it("forwards a submitted individual entry once the submission deadline passes", () => {
    expect(
      decide(otherStatus("submitted"), forward("individual"), closesAt)
    ).toEqual({ ok: true, to: "submitted_to_foa", event: null });
  });

  it("forwards an entry that only finished processing after the deadline", () => {
    const later = new Date(closesAt.getTime() + 3 * DAY);
    expect(
      decide(otherStatus("submitted"), forward("individual"), later)
    ).toMatchObject({ ok: true, to: "submitted_to_foa" });
  });

  it("waits until the submission deadline", () => {
    const before = new Date(closesAt.getTime() - 1);
    expect(
      decide(otherStatus("submitted"), forward("individual"), before)
    ).toEqual({ ok: false, code: "submission_still_open" });
  });

  it("never forwards a school-route entry, which reaches FOA through its school round", () => {
    expect(
      decide(otherStatus("submitted"), forward("school"), closesAt)
    ).toEqual({ ok: false, code: "school_route" });
  });

  it.each(["processing", "rejected", "failed"])(
    "does not forward an entry that is %s",
    (status) => {
      expect(
        decide(otherStatus(status), forward("individual"), closesAt)
      ).toEqual({ ok: false, code: "not_submitted" });
    }
  );

  it("does not forward an entry twice", () => {
    for (const state of [awaiting, verified, sentBack(NOW)]) {
      expect(decide(state, forward("individual"), closesAt)).toEqual({
        ok: false,
        code: "not_submitted",
      });
    }
  });
});
