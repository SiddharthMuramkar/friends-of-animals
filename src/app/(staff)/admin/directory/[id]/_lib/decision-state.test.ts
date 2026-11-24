import { describe, expect, it } from "vitest";

import { afterDecision, decisionFrom, START } from "./decision-state";

describe("the listing decision form's state", () => {
  it("reads the pressed decision, and nothing it doesn't know", () => {
    const form = new FormData();
    form.set("listingId", "01938a00-0000-7000-8000-000000012703");
    form.set("reason", "Checked.");
    form.set("decision", "verify");
    expect(decisionFrom(form)).toEqual({
      listingId: "01938a00-0000-7000-8000-000000012703",
      decision: "verify",
      reason: "Checked.",
    });
    form.set("decision", "withdraw");
    expect(decisionFrom(form)).toBeUndefined();
  });

  it("keeps the reason and says what to fix", () => {
    expect(
      afterDecision(START, " ", { ok: false, error: "reason_required" })
    ).toEqual({ attempt: 1, reason: " ", error: "reason_required" });
    expect(
      afterDecision(START, "x", { ok: false, error: "not_found" })
    ).toEqual({ attempt: 1, reason: "x", alert: "unexpected" });
  });
});
