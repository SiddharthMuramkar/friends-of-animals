import { describe, expect, it } from "vitest";

import { afterWithdraw, WITHDRAW_START, withdrawFrom } from "./withdraw-state";

describe("the withdraw form's state", () => {
  it("reads the listing and reason from the form", () => {
    const form = new FormData();
    form.set("listingId", "01938a00-0000-7000-8000-000000012701");
    form.set("reason", "We merged.");
    expect(withdrawFrom(form)).toEqual({
      listingId: "01938a00-0000-7000-8000-000000012701",
      reason: "We merged.",
    });
  });

  it("keeps the reason and says what went wrong", () => {
    expect(
      afterWithdraw(WITHDRAW_START, "x", {
        ok: false,
        error: "reason_too_long",
      })
    ).toEqual({ attempt: 1, reason: "x", error: "reason_too_long" });
    expect(
      afterWithdraw(WITHDRAW_START, "x", {
        ok: false,
        error: "invalid_input",
        fields: ["listingId"],
      })
    ).toEqual({ attempt: 1, reason: "x", error: "unexpected" });
  });
});
