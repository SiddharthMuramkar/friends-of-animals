import { describe, expect, it } from "vitest";

import {
  AMBASSADOR_THRESHOLD_BOUNDS,
  AMBASSADOR_THRESHOLD_DEFAULTS,
  type AmbassadorThresholds,
  checkAmbassadorEligibility,
  type EligibilityFacts,
  eligibilitySnapshotSchema,
  type EligibilityRule,
  membershipDays,
  QUALIFYING_MILESTONES,
  toEligibilitySnapshot,
} from "./eligibility";

const NOW = new Date("2027-06-15T04:30:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const THRESHOLDS: AmbassadorThresholds = {
  minMembershipDays: 90,
  minAgeYears: 18,
  qualifyingMilestones: ["foa_finalist", "volunteer"],
};

/** Passes every rule with the thresholds above. */
const ELIGIBLE: EligibilityFacts = {
  membership: { status: "active", joinedAt: daysAgo(120) },
  milestones: ["participant", "foa_finalist", "community_member"],
  ageYears: 19,
  hasOpenApplication: false,
};

const check = (
  facts: Partial<EligibilityFacts> = {},
  options: {
    thresholds?: Partial<AmbassadorThresholds>;
    purpose?: "apply" | "approve";
  } = {}
) =>
  checkAmbassadorEligibility({
    facts: { ...ELIGIBLE, ...facts },
    thresholds: { ...THRESHOLDS, ...options.thresholds },
    now: NOW,
    purpose: options.purpose ?? "apply",
  });

describe("ambassador eligibility", () => {
  it("passes a long-standing adult member who was an FOA finalist", () => {
    const result = check();
    expect(result.eligible).toBe(true);
    expect(result.failing).toEqual([]);
    expect(result.checks.map((c) => c.rule)).toEqual([
      "community_member",
      "membership_days",
      "minimum_age",
      "qualifying_milestone",
      "not_already_ambassador",
      "no_open_application",
    ]);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  // Each row breaks exactly one rule (and what follows from it).
  const failingAlone: {
    name: string;
    facts: Partial<EligibilityFacts>;
    failing: EligibilityRule[];
  }[] = [
    {
      name: "not a community member",
      facts: { membership: null },
      failing: ["community_member", "membership_days"],
    },
    {
      name: "left the community",
      facts: { membership: { status: "left", joinedAt: daysAgo(400) } },
      failing: ["community_member", "membership_days"],
    },
    {
      name: "a member for 89 days",
      facts: { membership: { status: "active", joinedAt: daysAgo(89) } },
      failing: ["membership_days"],
    },
    {
      name: "17 years old",
      facts: { ageYears: 17 },
      failing: ["minimum_age"],
    },
    {
      name: "no date of birth on record",
      facts: { ageYears: null },
      failing: ["minimum_age"],
    },
    {
      name: "no qualifying milestone",
      facts: { milestones: ["participant", "community_member"] },
      failing: ["qualifying_milestone"],
    },
    {
      name: "already an ambassador",
      facts: { milestones: ["foa_finalist", "ambassador"] },
      failing: ["not_already_ambassador"],
    },
    {
      name: "an application already open",
      facts: { hasOpenApplication: true },
      failing: ["no_open_application"],
    },
  ];

  it.each(failingAlone)("refuses $name", ({ facts, failing }) => {
    const result = check(facts);
    expect(result.eligible).toBe(false);
    expect(result.failing).toEqual(failing);
  });

  it("counts whole days of membership, from the current spell", () => {
    expect(
      check({ membership: { status: "active", joinedAt: daysAgo(90) } })
    ).toMatchObject({ eligible: true });
    const almost = new Date(daysAgo(90).getTime() + 1);
    expect(
      check({ membership: { status: "active", joinedAt: almost } }).failing
    ).toEqual(["membership_days"]);
  });

  it("reads the thresholds it is given, not fixed numbers", () => {
    const newMember = {
      membership: { status: "active" as const, joinedAt: daysAgo(45) },
    };
    expect(check(newMember).eligible).toBe(false);
    expect(
      check(newMember, { thresholds: { minMembershipDays: 30 } }).eligible
    ).toBe(true);
    expect(
      check({ ageYears: 16 }, { thresholds: { minAgeYears: 16 } }).eligible
    ).toBe(true);
    const participantOnly = { milestones: ["participant"] };
    expect(check(participantOnly).eligible).toBe(false);
    expect(
      check(participantOnly, {
        thresholds: { qualifyingMilestones: ["participant"] },
      }).eligible
    ).toBe(true);
  });

  it("needs no milestone when no qualifying milestone is set", () => {
    const result = check(
      { milestones: [] },
      { thresholds: { qualifyingMilestones: [] } }
    );
    expect(result.eligible).toBe(true);
  });

  it("accepts any one of the qualifying milestones", () => {
    expect(check({ milestones: ["volunteer"] }).eligible).toBe(true);
    expect(check({ milestones: ["foa_finalist"] }).eligible).toBe(true);
  });

  it("lists the qualifying milestones held, in ladder order, once each", () => {
    const result = check({
      milestones: ["volunteer", "participant", "ambassador", "participant"],
    });
    expect(result.checks).toContainEqual({
      rule: "qualifying_milestone",
      passed: true,
      anyOf: ["foa_finalist", "volunteer"],
      held: ["participant", "volunteer"],
    });
  });

  it("names the numbers each check compared, without the age", () => {
    const result = check({
      membership: { status: "active", joinedAt: daysAgo(10) },
      ageYears: 16,
    });
    expect(result.checks).toContainEqual({
      rule: "membership_days",
      passed: false,
      required: 90,
      actual: 10,
    });
    expect(result.checks).toContainEqual({
      rule: "minimum_age",
      passed: false,
      required: 18,
      known: true,
    });
    expect(JSON.stringify(result.checks)).not.toContain("16");
  });

  it("leaves the open-application rule out when approving", () => {
    const result = check({ hasOpenApplication: true }, { purpose: "approve" });
    expect(result.eligible).toBe(true);
    expect(result.checks.map((c) => c.rule)).not.toContain(
      "no_open_application"
    );
  });

  it("still applies every other rule when approving", () => {
    const result = check(
      { membership: { status: "left", joinedAt: daysAgo(400) } },
      { purpose: "approve" }
    );
    expect(result.failing).toEqual(["community_member", "membership_days"]);
  });
});

describe("membershipDays", () => {
  it("counts completed days", () => {
    expect(membershipDays(daysAgo(0), NOW)).toBe(0);
    expect(membershipDays(new Date(NOW.getTime() - DAY + 1), NOW)).toBe(0);
    expect(membershipDays(daysAgo(1), NOW)).toBe(1);
    expect(membershipDays(daysAgo(365), NOW)).toBe(365);
  });

  it("never goes below zero", () => {
    expect(membershipDays(new Date(NOW.getTime() + DAY), NOW)).toBe(0);
  });
});

describe("the threshold defaults", () => {
  it("sit inside their bounds", () => {
    const { minMembershipDays, minAgeYears } = AMBASSADOR_THRESHOLD_BOUNDS;
    expect(
      AMBASSADOR_THRESHOLD_DEFAULTS.minMembershipDays
    ).toBeGreaterThanOrEqual(minMembershipDays.min);
    expect(AMBASSADOR_THRESHOLD_DEFAULTS.minMembershipDays).toBeLessThanOrEqual(
      minMembershipDays.max
    );
    expect(AMBASSADOR_THRESHOLD_DEFAULTS.minAgeYears).toBeGreaterThanOrEqual(
      minAgeYears.min
    );
    expect(AMBASSADOR_THRESHOLD_DEFAULTS.minAgeYears).toBeLessThanOrEqual(
      minAgeYears.max
    );
  });

  it("keep adults only until FOA decides otherwise", () => {
    expect(AMBASSADOR_THRESHOLD_DEFAULTS.minAgeYears).toBe(18);
  });

  it("qualify by FOA finalist or volunteer", () => {
    expect(AMBASSADOR_THRESHOLD_DEFAULTS.qualifyingMilestones).toEqual([
      "foa_finalist",
      "volunteer",
    ]);
    for (const kind of AMBASSADOR_THRESHOLD_DEFAULTS.qualifyingMilestones) {
      expect(QUALIFYING_MILESTONES).toContain(kind);
    }
  });

  it("never let the ambassador or community-member rung qualify", () => {
    expect(QUALIFYING_MILESTONES).not.toContain("ambassador");
    expect(QUALIFYING_MILESTONES).not.toContain("community_member");
  });
});

describe("the eligibility snapshot", () => {
  it("round-trips through JSON, as the jsonb column stores it", () => {
    const result = check({ ageYears: 17 });
    const snapshot = toEligibilitySnapshot(result);
    const stored: unknown = JSON.parse(JSON.stringify(snapshot));
    expect(eligibilitySnapshotSchema.parse(stored)).toEqual(snapshot);
    expect(snapshot).toMatchObject({
      version: 1,
      purpose: "apply",
      evaluatedAt: "2027-06-15T04:30:00.000Z",
      eligible: false,
      thresholds: THRESHOLDS,
    });
  });

  it("holds no age, only whether the minimum was met", () => {
    const snapshot = toEligibilitySnapshot(check({ ageYears: 47 }));
    expect(JSON.stringify(snapshot)).not.toContain("47");
    expect(snapshot.checks).toContainEqual({
      rule: "minimum_age",
      passed: true,
      required: 18,
      known: true,
    });
  });

  it("refuses a stored value of another shape", () => {
    const snapshot = toEligibilitySnapshot(check());
    expect(
      eligibilitySnapshotSchema.safeParse({ ...snapshot, version: 2 }).success
    ).toBe(false);
    expect(
      eligibilitySnapshotSchema.safeParse({
        ...snapshot,
        checks: [{ rule: "minimum_age", passed: true, required: 18, age: 30 }],
      }).success
    ).toBe(false);
  });

  it("does not share arrays with the thresholds it was given", () => {
    const thresholds: AmbassadorThresholds = {
      ...THRESHOLDS,
      qualifyingMilestones: ["volunteer"],
    };
    const snapshot = toEligibilitySnapshot(
      checkAmbassadorEligibility({
        facts: ELIGIBLE,
        thresholds,
        now: NOW,
        purpose: "apply",
      })
    );
    expect(snapshot.thresholds.qualifyingMilestones).not.toBe(
      thresholds.qualifyingMilestones
    );
  });
});
