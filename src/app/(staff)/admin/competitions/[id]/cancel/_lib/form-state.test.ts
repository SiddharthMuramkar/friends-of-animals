import { describe, expect, it } from "vitest";

import { afterCancel, CANCEL_START } from "./form-state";

const REASON = "The venue flooded.";

describe("afterCancel", () => {
  it("keeps the reason and marks it when it is missing or too long", () => {
    expect(
      afterCancel(CANCEL_START, "  ", { ok: false, error: "reason_required" })
    ).toEqual({ attempt: 1, reason: "  ", error: "reason_required" });
    expect(
      afterCancel(CANCEL_START, REASON, {
        ok: false,
        error: "reason_too_long",
      })
    ).toEqual({ attempt: 1, reason: REASON, error: "reason_too_long" });
  });

  it("says when it was cancelled already, or is gone", () => {
    expect(
      afterCancel(CANCEL_START, REASON, {
        ok: false,
        error: "already_cancelled",
      })
    ).toEqual({ attempt: 1, reason: REASON, alert: "already_cancelled" });
    expect(
      afterCancel(CANCEL_START, REASON, { ok: false, error: "not_found" })
    ).toEqual({ attempt: 1, reason: REASON, alert: "not_found" });
  });

  it("calls anything else unexpected, and counts each attempt", () => {
    const once = afterCancel(CANCEL_START, REASON, "unexpected");
    expect(once).toEqual({ attempt: 1, reason: REASON, alert: "unexpected" });
    expect(
      afterCancel(once, REASON, {
        ok: false,
        error: "invalid_input",
        fields: ["reason"],
      })
    ).toEqual({ attempt: 2, reason: REASON, alert: "unexpected" });
  });
});
