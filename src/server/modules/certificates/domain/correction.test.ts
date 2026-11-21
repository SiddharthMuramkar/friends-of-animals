import { describe, expect, it } from "vitest";

import {
  AWARD_LABEL_MAX_LENGTH,
  parseReason,
  planReissue,
  REASON_MAX_LENGTH,
  RECIPIENT_NAME_MAX_LENGTH,
  type CorrectableFields,
} from "./correction";

describe("parseReason", () => {
  it("keeps a reason, tidied", () => {
    expect(parseReason("  Name misspelt\n on the   PDF ")).toEqual({
      ok: true,
      reason: "Name misspelt on the PDF",
    });
  });

  it.each(["", "   ", "\n\t "])("refuses a blank reason (%j)", (input) => {
    expect(parseReason(input)).toEqual({ ok: false, error: "required" });
  });

  it("drops control characters", () => {
    expect(parseReason("Duplicate\u0000 entry\u0007")).toEqual({
      ok: true,
      reason: "Duplicate entry",
    });
    expect(parseReason("\u0000\u0007")).toEqual({
      ok: false,
      error: "required",
    });
  });

  it("allows 500 characters and refuses 501", () => {
    expect(REASON_MAX_LENGTH).toBe(500);
    expect(parseReason("a".repeat(500)).ok).toBe(true);
    expect(parseReason("a".repeat(501))).toEqual({
      ok: false,
      error: "too_long",
    });
  });

  it("counts characters as a reader does", () => {
    // "रा" is two code points but one character on screen.
    expect(parseReason("रा".repeat(500)).ok).toBe(true);
  });
});

describe("planReissue", () => {
  const winner: CorrectableFields = {
    recipientName: "Asha Rao",
    awardLabel: "First prize",
  };
  const participation: CorrectableFields = {
    recipientName: "Kabir Singh",
    awardLabel: null,
  };

  it("corrects the name and keeps the award", () => {
    expect(planReissue(winner, { recipientName: "Asha  Rao-Iyer " })).toEqual({
      ok: true,
      next: { recipientName: "Asha Rao-Iyer", awardLabel: "First prize" },
      changed: ["recipientName"],
    });
  });

  it("corrects the award label and keeps the name", () => {
    expect(planReissue(winner, { awardLabel: "First prize, Junior" })).toEqual({
      ok: true,
      next: { recipientName: "Asha Rao", awardLabel: "First prize, Junior" },
      changed: ["awardLabel"],
    });
  });

  it("corrects both at once", () => {
    const plan = planReissue(winner, {
      recipientName: "Aasha Rao",
      awardLabel: "Second prize",
    });
    expect(plan).toEqual({
      ok: true,
      next: { recipientName: "Aasha Rao", awardLabel: "Second prize" },
      changed: ["recipientName", "awardLabel"],
    });
  });

  it("treats a change of case as a correction", () => {
    expect(planReissue(winner, { recipientName: "asha rao" })).toMatchObject({
      ok: true,
      changed: ["recipientName"],
    });
  });

  it("refuses a request that changes nothing", () => {
    expect(planReissue(winner, {})).toEqual({
      ok: false,
      reason: "no_change",
    });
    expect(
      planReissue(winner, {
        recipientName: " Asha   Rao ",
        awardLabel: "First prize",
      })
    ).toEqual({ ok: false, reason: "no_change" });
  });

  it("compares names in one Unicode form", () => {
    // "é" typed as e + combining accent is the same name as the stored "é".
    const stored: CorrectableFields = {
      recipientName: "René D'Souza",
      awardLabel: null,
    };
    expect(planReissue(stored, { recipientName: "René D'Souza" })).toEqual({
      ok: false,
      reason: "no_change",
    });
  });

  it("stores the corrected name in composed form", () => {
    const plan = planReissue(participation, {
      recipientName: "René Singh",
    });
    expect(plan.ok && plan.next.recipientName).toBe("René Singh");
  });

  it("keeps a Devanagari name intact", () => {
    const plan = planReissue(participation, { recipientName: "आशा राव" });
    expect(plan.ok && plan.next.recipientName).toBe("आशा राव");
  });

  it.each([
    ["", "required"],
    ["   ", "required"],
    ["A", "too_short"],
    ["A".repeat(101), "too_long"],
  ] as const)("refuses the name %j (%s)", (recipientName, error) => {
    expect(planReissue(winner, { recipientName })).toEqual({
      ok: false,
      reason: "invalid",
      errors: { recipientName: error },
    });
  });

  it("allows a name of 2 to 100 characters, as enrolment does", () => {
    expect(RECIPIENT_NAME_MAX_LENGTH).toBe(100);
    expect(planReissue(winner, { recipientName: "Al" }).ok).toBe(true);
    expect(planReissue(winner, { recipientName: "A".repeat(100) }).ok).toBe(
      true
    );
  });

  it.each([
    ["", "required"],
    ["  ", "required"],
    ["x".repeat(AWARD_LABEL_MAX_LENGTH + 1), "too_long"],
  ] as const)("refuses the award label %j (%s)", (awardLabel, error) => {
    expect(planReissue(winner, { awardLabel })).toEqual({
      ok: false,
      reason: "invalid",
      errors: { awardLabel: error },
    });
  });

  it("never adds an award to a certificate that has none", () => {
    // What was awarded comes from the published results, not a correction.
    expect(planReissue(participation, { awardLabel: "First prize" })).toEqual({
      ok: false,
      reason: "invalid",
      errors: { awardLabel: "not_applicable" },
    });
  });

  it("reports every invalid field at once", () => {
    expect(
      planReissue(participation, { recipientName: "", awardLabel: "Winner" })
    ).toEqual({
      ok: false,
      reason: "invalid",
      errors: { recipientName: "required", awardLabel: "not_applicable" },
    });
  });
});
