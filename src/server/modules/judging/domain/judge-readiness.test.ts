import { describe, expect, it } from "vitest";

import {
  ONBOARDING_STEPS,
  judgeReadiness,
  type JudgeOnboardingFacts,
} from "./judge-readiness";

const AT = new Date("2027-01-15T04:30:00.000Z");

const ONBOARDED: JudgeOnboardingFacts = {
  holdsRoundRole: true,
  conductAcceptedAt: AT,
  confidentialityAcceptedAt: AT,
  conflictsDeclaredAt: AT,
};

describe("whether a judge may be assigned and shown entries", () => {
  it("lists the steps in the order the judge takes them", () => {
    expect(ONBOARDING_STEPS).toEqual([
      "invitation",
      "conduct",
      "confidentiality",
      "conflicts",
    ]);
  });

  it("is ready once every step is done", () => {
    expect(judgeReadiness(ONBOARDED)).toEqual({ ready: true });
  });

  it("names every missing step, in order", () => {
    expect(
      judgeReadiness({
        holdsRoundRole: false,
        conductAcceptedAt: null,
        confidentialityAcceptedAt: null,
        conflictsDeclaredAt: null,
      })
    ).toEqual({
      ready: false,
      missing: ["invitation", "conduct", "confidentiality", "conflicts"],
    });
  });

  it.each([
    ["without the round's judge role", { holdsRoundRole: false }, "invitation"],
    ["before the code of conduct", { conductAcceptedAt: null }, "conduct"],
    [
      "before the confidentiality terms",
      { confidentialityAcceptedAt: null },
      "confidentiality",
    ],
    ["before declaring conflicts", { conflictsDeclaredAt: null }, "conflicts"],
  ] as const)("is not ready %s", (_, gap, step) => {
    expect(judgeReadiness({ ...ONBOARDED, ...gap })).toEqual({
      ready: false,
      missing: [step],
    });
  });

  it("is not ready when the role was removed after onboarding", () => {
    expect(judgeReadiness({ ...ONBOARDED, holdsRoundRole: false })).toEqual({
      ready: false,
      missing: ["invitation"],
    });
  });
});
