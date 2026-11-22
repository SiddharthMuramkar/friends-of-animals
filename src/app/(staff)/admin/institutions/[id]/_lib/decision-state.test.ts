import { describe, expect, it } from "vitest";

import { afterDecision, decisionFrom, START } from "./decision-state";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

describe("the decision form's state", () => {
  it("reads the institution, the pressed button and the reason", () => {
    expect(
      decisionFrom(
        form({ institutionId: "abc", decision: "verify", reason: " ok " })
      )
    ).toEqual({ institutionId: "abc", decision: "verify", reason: " ok " });
  });

  it("refuses a button that isn't a decision", () => {
    expect(
      decisionFrom(form({ institutionId: "abc", decision: "delete" }))
    ).toBeUndefined();
  });

  it("puts a missing or long reason on the reason field, keeping what was typed", () => {
    expect(
      afterDecision(START, "  ", { ok: false, error: "reason_required" })
    ).toEqual({ attempt: 1, reason: "  ", error: "reason_required" });
    expect(
      afterDecision(START, "x", { ok: false, error: "reason_too_long" })
    ).toMatchObject({ error: "reason_too_long" });
  });

  it("explains a decision someone else overtook, for the whole form", () => {
    expect(
      afterDecision(START, "ok", {
        ok: false,
        error: "transition_not_allowed",
      })
    ).toEqual({ attempt: 1, reason: "ok", alert: "transition_not_allowed" });
  });
});
