import { z } from "zod";
import type { MilestoneKind } from "../../domain/milestones";

export const QUALIFYING_MILESTONES = [
  "participant",
  "school_winner",
  "foa_finalist",
  "volunteer",
] as const;
export const DEFAULT_QUALIFICATION = "foa_finalist,volunteer";
export const qualificationSetting = z.string().refine((value) => {
  const kinds = value.split(",");
  return (
    kinds.length === new Set(kinds).size &&
    kinds.every((kind) =>
      QUALIFYING_MILESTONES.some((allowed) => allowed === kind)
    )
  );
});
export const DEFAULT_MEMBERSHIP_DAYS = 90;
export const ADULT_AGE_FLOOR = 18;

export type Thresholds = {
  membershipDays: number;
  ageYears: number;
  qualifyingMilestones: string;
};
export type EligibilityFacts = {
  membership: { status: "active" | "left"; joinedAt: Date } | null;
  ageYears: number | null;
  milestones: readonly MilestoneKind[];
  hasOpenApplication: boolean;
};

export function ambassadorEligibility(
  facts: EligibilityFacts,
  thresholds: Thresholds,
  now: Date,
  purpose: "apply" | "approve"
) {
  const active = facts.membership?.status === "active";
  const elapsedDays = facts.membership
    ? Math.floor(
        (now.getTime() - facts.membership.joinedAt.getTime()) / 86_400_000
      )
    : 0;
  const ageFloor = Math.max(ADULT_AGE_FLOOR, thresholds.ageYears);
  const requiredMilestones = thresholds.qualifyingMilestones.split(",");
  const checks = {
    activeMembership: active,
    membershipDays: active && elapsedDays >= thresholds.membershipDays,
    minimumAge: facts.ageYears !== null && facts.ageYears >= ageFloor,
    qualifyingMilestone: facts.milestones.some((kind) =>
      requiredMilestones.includes(kind)
    ),
    notAmbassador: !facts.milestones.includes("ambassador"),
    noOpenApplication: purpose === "approve" || !facts.hasOpenApplication,
  };
  return {
    purpose,
    eligible: Object.values(checks).every(Boolean),
    checks,
    thresholds: { ...thresholds, ageYears: ageFloor },
    requiredMilestones,
  };
}
