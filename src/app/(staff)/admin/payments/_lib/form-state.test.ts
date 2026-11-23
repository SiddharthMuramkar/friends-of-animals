import { describe, expect, it } from "vitest";

import {
  afterRecord,
  afterResolve,
  offlineEntered,
  offlineStart,
  RESOLVE_START,
  uploadAlert,
} from "./form-state";

describe("afterResolve()", () => {
  it("keeps the reason and marks a reason that is too short or too long", () => {
    expect(
      afterResolve(RESOLVE_START, "ok", {
        ok: false,
        error: "reason_required",
      })
    ).toEqual({ attempt: 1, reason: "ok", error: "reason_required" });
    expect(
      afterResolve({ attempt: 1, reason: "" }, "x", {
        ok: false,
        error: "reason_too_long",
      })
    ).toEqual({ attempt: 2, reason: "x", error: "reason_too_long" });
  });

  it.each([
    "outcome_not_allowed",
    "resolve_other_cases_first",
    "registration_not_payable",
    "already_resolved",
  ] as const)("alerts %s for the whole form", (error) => {
    expect(
      afterResolve(RESOLVE_START, "A sentence of reason.", {
        ok: false,
        error,
      })
    ).toEqual({ attempt: 1, reason: "A sentence of reason.", alert: error });
  });

  it("calls anything else unexpected, keeping the reason", () => {
    expect(
      afterResolve(RESOLVE_START, "kept", { ok: false, error: "not_found" })
    ).toEqual({ attempt: 1, reason: "kept", alert: "unexpected" });
    expect(afterResolve(RESOLVE_START, "kept", "unexpected")).toEqual({
      attempt: 1,
      reason: "kept",
      alert: "unexpected",
    });
  });
});

describe("the offline payment form's state", () => {
  const entered = {
    method: "bank_transfer",
    reference: "UTR 1",
    amount: "999",
    receivedOn: "2027-01-16",
  };

  it("starts on a cheque for the batch's amount, received today", () => {
    expect(offlineStart({ amount: "2000", receivedOn: "2027-01-15" })).toEqual({
      attempt: 0,
      entered: {
        method: "cheque",
        reference: "",
        amount: "2000",
        receivedOn: "2027-01-15",
      },
      errors: {},
    });
  });

  it("reads what the form sent, as typed", () => {
    const form = new FormData();
    for (const [name, value] of Object.entries(entered)) form.set(name, value);
    form.set("proof", new Blob(["x"]));

    expect(offlineEntered(form)).toEqual(entered);
  });

  it("marks every wrong field at once, keeping what was typed", () => {
    const start = offlineStart({ amount: "", receivedOn: "" });
    expect(
      afterRecord(start, entered, {
        ok: false,
        error: "fields_invalid",
        errors: {
          reference: "reference_invalid",
          amountMinor: "amount_mismatch",
          receivedOn: "received_in_future",
        },
      })
    ).toEqual({
      attempt: 1,
      entered,
      errors: {
        reference: "reference_invalid",
        amountMinor: "amount_mismatch",
        receivedOn: "received_in_future",
      },
    });
  });

  it("alerts a refusal of the whole payment, and an upload that failed", () => {
    const start = offlineStart({ amount: "", receivedOn: "" });
    expect(
      afterRecord(start, entered, { ok: false, error: "already_paid" })
    ).toMatchObject({ errors: {}, alert: "already_paid" });
    expect(afterRecord(start, entered, "upload_failed")).toMatchObject({
      entered,
      alert: "upload_failed",
    });
    expect(
      afterRecord(start, entered, { ok: false, error: "not_found" })
    ).toMatchObject({ alert: "unexpected" });
  });

  it("names the upload refusals a person can fix, and nothing else", () => {
    expect(uploadAlert("too_large")).toBe("too_large");
    expect(uploadAlert("type_not_allowed")).toBe("type_not_allowed");
    expect(uploadAlert("empty")).toBe("empty");
    expect(uploadAlert("purpose_unavailable")).toBe("unexpected");
    expect(uploadAlert("not_found")).toBe("unexpected");
  });
});
