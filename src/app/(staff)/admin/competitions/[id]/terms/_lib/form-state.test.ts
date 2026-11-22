import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import type { SetCompetitionFeesResult } from "@/server/modules/competitions/terms";

import {
  afterSetFees,
  afterSetRoundAwards,
  awardsEnteredFrom,
  feesEnteredFrom,
  secondFactorRedirect,
  type FeesFormState,
} from "./form-state";

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

  it.each<[SetCompetitionFeesResult, FeesFormState["alert"]]>([
    [{ ok: false, error: "fees_locked" }, "locked"],
    [{ ok: false, error: "participation_not_set" }, "noParticipation"],
    [{ ok: false, error: "not_found" }, "failed"],
    [
      { ok: false, error: "invalid_input", fields: ["competitionId"] },
      "failed",
    ],
    [
      {
        ok: false,
        error: "invalid_fees",
        problems: [{ code: "unsupported_currency" }],
      },
      "currency",
    ],
  ])("gives the whole form a problem for %j", (result, alert) => {
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
    expect(
      afterSetRoundAwards({ ok: false, error: "not_found" }, awards)
    ).toEqual({ entered: awards, error: "failed" });
  });
});

describe("secondFactorRedirect", () => {
  const id = "01938a00-0000-7000-8000-000000002101";
  const back = encodeURIComponent(`/admin/competitions/${id}/terms`);

  it("sends a fee change refused for an old second factor to step up, then back here", () => {
    expect(
      secondFactorRedirect(new DomainError("step_up_required", "refused"), id)
    ).toBe(`/auth/step-up?next=${back}`);
    expect(
      secondFactorRedirect(
        new DomainError("second_factor_required", "refused"),
        id
      )
    ).toBe(`/auth/second-factor?next=${back}`);
  });

  it("is null for a refusal no second factor lifts, or any other error", () => {
    expect(
      secondFactorRedirect(new DomainError("forbidden", "refused"), id)
    ).toBeNull();
    expect(secondFactorRedirect(new Error("boom"), id)).toBeNull();
  });
});

describe("feesEnteredFrom", () => {
  it("fills the form with the stored fees in rupees, empty where none is set", () => {
    expect(
      feesEnteredFrom([
        { route: "individual", kind: "amount", paise: 2147483649n },
        { route: "institution", kind: "not_set" },
      ])
    ).toEqual({
      mode: "paid",
      fees: { individual: "21474836.49", institution: "" },
    });
    expect(
      feesEnteredFrom([
        { route: "individual", kind: "free" },
        { route: "institution", kind: "amount", paise: 100000n },
      ])
    ).toEqual({ mode: "paid", fees: { individual: "0", institution: "1000" } });
  });

  it("chooses free when every offered route is free", () => {
    expect(
      feesEnteredFrom([
        { route: "individual", kind: "free" },
        { route: "institution", kind: "free" },
      ])
    ).toEqual({ mode: "free", fees: { individual: "0", institution: "0" } });
  });

  it("starts paid and empty with no route offered yet", () => {
    expect(feesEnteredFrom([])).toEqual({ mode: "paid", fees: {} });
  });
});

describe("awardsEnteredFrom", () => {
  it("fills a round's form with its scheme and each band's prize, empty for none", () => {
    expect(
      awardsEnteredFrom({
        roundKey: "school",
        scheme: "grades_ab",
        bands: [
          { band: "grade_a", prize: "Trophy" },
          { band: "grade_b", prize: null },
        ],
      })
    ).toEqual({
      scheme: "grades_ab",
      prizes: { grade_a: "Trophy", grade_b: "" },
    });
  });
});
