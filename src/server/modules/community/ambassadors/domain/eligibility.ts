// Who may apply to be an FOA Ambassador (#122). One function checks every
// rule against facts the use case gathers (membership, milestones across
// all of the person's subjects, age from the stored date of birth, an open
// application) and thresholds read from runtime settings, so FOA changes
// the rule without a deploy. The dashboard explains the same result the
// apply and approve use cases enforce.
//
// The result never carries the age: the minimum-age check says only
// whether the minimum was met, so the snapshot stored with an application
// is no more sensitive than the application itself.
//
// Pure. Loads under plain Node (the settings catalogue imports the
// defaults), so no "server-only" and no "@/" imports.

import { z } from "zod";

/**
 * The rungs FOA may require, in ladder order. A subset of the Community
 * module's milestone kinds (#119): joining is a rule of its own, and the
 * ambassador rung is what the application leads to.
 */
export const QUALIFYING_MILESTONES = [
  "participant",
  "school_winner",
  "foa_finalist",
  "volunteer",
] as const;

export type QualifyingMilestone = (typeof QUALIFYING_MILESTONES)[number];

export type AmbassadorThresholds = {
  /** Whole days in the community, counted from the current membership. */
  minMembershipDays: number;
  /** Completed years of age, on the Indian calendar. */
  minAgeYears: number;
  /** Any one of these is enough; an empty list asks for none. */
  qualifyingMilestones: readonly QualifyingMilestone[];
};

/**
 * Defaults until FOA sets the thresholds (HR-57). Adults only, because the
 * application has no guardian step; lowering the age needs one.
 */
export const AMBASSADOR_THRESHOLD_DEFAULTS: AmbassadorThresholds = {
  minMembershipDays: 90,
  minAgeYears: 18,
  qualifyingMilestones: ["foa_finalist", "volunteer"],
};

/** What the settings screen accepts. 13 is the age of an own login. */
export const AMBASSADOR_THRESHOLD_BOUNDS = {
  minMembershipDays: { min: 0, max: 3650 },
  minAgeYears: { min: 13, max: 100 },
} as const;

export type EligibilityFacts = {
  /** The person's membership, or null if they never joined. */
  membership: { status: "active" | "left"; joinedAt: Date } | null;
  /**
   * Milestone kinds reached on any of the person's subjects. May hold
   * kinds that don't qualify (community member, ambassador).
   */
  milestones: readonly string[];
  /** Completed years at `now` from the stored date of birth; null if none. */
  ageYears: number | null;
  /** Whether the person already has an application waiting for a decision. */
  hasOpenApplication: boolean;
};

/** Every rule, in the order the dashboard explains them. */
export const ELIGIBILITY_RULES = [
  "community_member",
  "membership_days",
  "minimum_age",
  "qualifying_milestone",
  "not_already_ambassador",
  "no_open_application",
] as const;

export type EligibilityRule = (typeof ELIGIBILITY_RULES)[number];

/** Why someone checks: before applying, or when a manager approves. */
export type EligibilityPurpose = "apply" | "approve";

const qualifyingMilestone = z.enum(QUALIFYING_MILESTONES);

const checkSchema = z.discriminatedUnion("rule", [
  z.strictObject({ rule: z.literal("community_member"), passed: z.boolean() }),
  z.strictObject({
    rule: z.literal("membership_days"),
    passed: z.boolean(),
    required: z.int().min(0),
    /** Null when the person isn't an active member. */
    actual: z.int().min(0).nullable(),
  }),
  z.strictObject({
    rule: z.literal("minimum_age"),
    passed: z.boolean(),
    required: z.int().min(0),
    /** False when no date of birth is on record. */
    known: z.boolean(),
  }),
  z.strictObject({
    rule: z.literal("qualifying_milestone"),
    passed: z.boolean(),
    anyOf: z.array(qualifyingMilestone),
    held: z.array(qualifyingMilestone),
  }),
  z.strictObject({
    rule: z.literal("not_already_ambassador"),
    passed: z.boolean(),
  }),
  z.strictObject({
    rule: z.literal("no_open_application"),
    passed: z.boolean(),
  }),
]);

export type EligibilityCheck = z.infer<typeof checkSchema>;

export type AmbassadorEligibility = {
  eligible: boolean;
  /** Every rule checked, in `ELIGIBILITY_RULES` order. */
  checks: EligibilityCheck[];
  /** The rules that failed, in the same order. */
  failing: EligibilityRule[];
  purpose: EligibilityPurpose;
  thresholds: AmbassadorThresholds;
  evaluatedAt: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Completed days from `joinedAt` to `now`; never below zero. */
export function membershipDays(joinedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - joinedAt.getTime()) / DAY_MS));
}

/**
 * Checks every rule. When approving, the open-application rule is left
 * out: the open application is the one being decided.
 */
export function checkAmbassadorEligibility(input: {
  facts: EligibilityFacts;
  thresholds: AmbassadorThresholds;
  now: Date;
  purpose: EligibilityPurpose;
}): AmbassadorEligibility {
  const { facts, thresholds, now, purpose } = input;
  const active = facts.membership?.status === "active";
  const days =
    active && facts.membership
      ? membershipDays(facts.membership.joinedAt, now)
      : null;
  const held = QUALIFYING_MILESTONES.filter((kind) =>
    facts.milestones.includes(kind)
  );
  const anyOf = [...thresholds.qualifyingMilestones];

  const checks: EligibilityCheck[] = [
    { rule: "community_member", passed: active },
    {
      rule: "membership_days",
      passed: days !== null && days >= thresholds.minMembershipDays,
      required: thresholds.minMembershipDays,
      actual: days,
    },
    {
      rule: "minimum_age",
      passed:
        facts.ageYears !== null && facts.ageYears >= thresholds.minAgeYears,
      required: thresholds.minAgeYears,
      known: facts.ageYears !== null,
    },
    {
      rule: "qualifying_milestone",
      passed: anyOf.length === 0 || anyOf.some((kind) => held.includes(kind)),
      anyOf,
      held,
    },
    {
      rule: "not_already_ambassador",
      passed: !facts.milestones.includes("ambassador"),
    },
  ];
  if (purpose === "apply") {
    checks.push({
      rule: "no_open_application",
      passed: !facts.hasOpenApplication,
    });
  }

  const failing = checks.filter((c) => !c.passed).map((c) => c.rule);
  return {
    eligible: failing.length === 0,
    checks,
    failing,
    purpose,
    thresholds: { ...thresholds, qualifyingMilestones: anyOf },
    evaluatedAt: now,
  };
}

/** The result as `ambassador_application` stores it (jsonb), and reads it back. */
export const eligibilitySnapshotSchema = z.strictObject({
  version: z.literal(1),
  purpose: z.enum(["apply", "approve"]),
  evaluatedAt: z.iso.datetime(),
  eligible: z.boolean(),
  thresholds: z.strictObject({
    minMembershipDays: z.int().min(0),
    minAgeYears: z.int().min(0),
    qualifyingMilestones: z.array(qualifyingMilestone),
  }),
  checks: z.array(checkSchema),
});

export type EligibilitySnapshot = z.infer<typeof eligibilitySnapshotSchema>;

/** A JSON-safe copy of `result`, to store with the application. */
export function toEligibilitySnapshot(
  result: AmbassadorEligibility
): EligibilitySnapshot {
  return {
    version: 1,
    purpose: result.purpose,
    evaluatedAt: result.evaluatedAt.toISOString(),
    eligible: result.eligible,
    thresholds: {
      minMembershipDays: result.thresholds.minMembershipDays,
      minAgeYears: result.thresholds.minAgeYears,
      qualifyingMilestones: [...result.thresholds.qualifyingMilestones],
    },
    checks: result.checks.map((check) =>
      check.rule === "qualifying_milestone"
        ? { ...check, anyOf: [...check.anyOf], held: [...check.held] }
        : { ...check }
    ),
  };
}
