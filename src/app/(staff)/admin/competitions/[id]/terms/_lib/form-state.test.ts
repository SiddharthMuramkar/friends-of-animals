import { describe, expect, it } from "vitest";

import { afterSetFees, afterSetRoundAwards } from "./form-state";

const entered = {
  mode: "paid",
  fees: { individual: "1,500", institution: "abc" },
} as const;

describe("afterSetFees", () => {
  it("says whether the fees were saved or were already so", () => {
    expect(afterSetFees({ ok: true, changed: true }, entered)).toEqual({
      entered,
      outcome: "saved",
      fieldErrors: {},
    });
    expect(afterSetFees({ ok: true, changed: false }, entered)).toEqual({
      entered,
      outcome: "unchanged",
      fieldErrors: {},
    });
  });

  it("puts each route's problem on its field, and keeps what was typed", () => {
    expect(
      afterSetFees(
        {
          ok: false,
          error: "invalid_fees",
          problems: [
            { code: "invalid_amount", route: "institution" },
            { code: "missing_fee", route: "individual" },
          ],
        },
        entered
      )
    ).toEqual({
      entered,
      fieldErrors: { institution: "invalid_amount", individual: "missing_fee" },
    });
  });

  it.each([
    [{ ok: false, error: "fees_locked" }, "locked"],
    [{ ok: false, error: "participation_not_set" }, "noParticipation"],
    [{ ok: false, error: "not_found" }, "failed"],
    [{ ok: false, error: "invalid_input", fields: ["competitionId"] }, "failed"],
    [
      {
        ok: false,
        error: "invalid_fees",
        problems: [{ code: "unsupported_currency" }],
      },
      "currency",
    ],
  ] as const)("gives the whole form a problem for %j", (result, alert) => {
    expect(afterSetFees(result, entered)).toEqual({
      entered,
      alert,
      fieldErrors: {},
    });
  });
});

describe("afterSetRoundAwards", () => {
  const awards = { scheme: "grades_ab", prizes: { grade_a: "Trophy" } };

  it("says whether the round was saved or was already so", () => {
    expect(afterSetRoundAwards({ ok: true, changed: true }, awards)).toEqual({
      entered: awards,
      outcome: "saved",
    });
    expect(afterSetRoundAwards({ ok: true, changed: false }, awards)).toEqual({
      entered: awards,
      outcome: "unchanged",
    });
  });

  it("names what to fix, and keeps what was typed", () => {
    expect(
      afterSetRoundAwards({ ok: false, error: "prize_too_long" }, awards)
    ).toEqual({ entered: awards, error: "prize_too_long" });
    expect(afterSetRoundAwards({ ok: false, error: "not_found" }, awards)).toEqual(
      { entered: awards, error: "failed" }
    );
  });
});
