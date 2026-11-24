import { describe, expect, it } from "vitest";

import {
  afterDecision,
  afterManual,
  afterRequest,
  DECISION_START,
  MANUAL_START,
  REQUEST_START,
} from "./form-state";

const ENTERED = { reason: "Floods closed the school.", registrationIds: ["a"] };

describe("afterRequest", () => {
  it("keeps what was typed and marks the reason", () => {
    expect(
      afterRequest(REQUEST_START, ENTERED, {
        ok: false,
        error: "reason_required",
      })
    ).toEqual({ attempt: 1, ...ENTERED, error: "reason_required" });
  });

  it("drops the choice of students once one of them is taken", () => {
    expect(
      afterRequest(REQUEST_START, ENTERED, {
        ok: false,
        error: "item_in_live_refund",
        registrationId: "a",
      })
    ).toEqual({
      attempt: 1,
      reason: ENTERED.reason,
      registrationIds: [],
      alert: "item_in_live_refund",
    });
  });

  it("calls anything the page can't explain unexpected", () => {
    expect(
      afterRequest(REQUEST_START, ENTERED, { ok: false, error: "not_found" })
    ).toMatchObject({ alert: "unexpected" });
    expect(afterRequest(REQUEST_START, ENTERED, "unexpected")).toMatchObject({
      attempt: 1,
      alert: "unexpected",
    });
  });
});

describe("afterDecision", () => {
  it("marks the note, or alerts for a refund that moved on", () => {
    expect(
      afterDecision(DECISION_START, " ", { ok: false, error: "note_required" })
    ).toEqual({ attempt: 1, note: " ", error: "note_required" });
    expect(
      afterDecision(DECISION_START, "", { ok: false, error: "same_person" })
    ).toEqual({ attempt: 1, note: "", alert: "same_person" });
    expect(
      afterDecision(DECISION_START, "", { ok: false, error: "not_failed" })
    ).toMatchObject({ alert: "not_failed" });
  });
});

describe("afterManual", () => {
  it("marks the reference and keeps the method", () => {
    expect(
      afterManual(
        MANUAL_START,
        { method: "cheque", reference: "x" },
        { ok: false, error: "reference_invalid" }
      )
    ).toEqual({
      attempt: 1,
      method: "cheque",
      reference: "x",
      error: "reference_invalid",
    });
  });

  it("tells the requester they can't pay out their own refund", () => {
    expect(
      afterManual(
        MANUAL_START,
        { method: "cheque", reference: "004512" },
        { ok: false, error: "same_person" }
      )
    ).toEqual({
      attempt: 1,
      method: "cheque",
      reference: "004512",
      alert: "same_person",
    });
  });
});
