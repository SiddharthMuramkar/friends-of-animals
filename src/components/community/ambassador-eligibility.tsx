import { getTranslations } from "next-intl/server";
import type { ambassadorEligibility } from "@/server/modules/community/ambassadors/domain/eligibility";
import { QUALIFYING_MILESTONES } from "@/server/modules/community/ambassadors/domain/eligibility";

type Eligibility = ReturnType<typeof ambassadorEligibility>;
export async function AmbassadorEligibility({ value }: { value: Eligibility }) {
  const [t, milestone] = await Promise.all([
    getTranslations("ambassadors"),
    getTranslations("community.timeline.milestones"),
  ]);
  const names = QUALIFYING_MILESTONES.filter((kind) =>
    value.requiredMilestones.includes(kind)
  )
    .map((kind) => milestone(kind))
    .join(", ");
  const labels = {
    activeMembership: t("checks.activeMembership"),
    membershipDays: t("checks.membershipDays", {
      days: value.thresholds.membershipDays,
    }),
    minimumAge: t("checks.minimumAge", { years: value.thresholds.ageYears }),
    qualifyingMilestone: t("checks.qualifyingMilestone", { milestones: names }),
    notAmbassador: t("checks.notAmbassador"),
    noOpenApplication: t("checks.noOpenApplication"),
  };
  return (
    <div className="space-y-4">
      <p className="font-semibold text-ink">
        {value.purpose === "approve"
          ? value.eligible
            ? t("admin.qualified")
            : t("admin.ineligible")
          : value.eligible
            ? t("qualified")
            : t("ineligible")}
      </p>
      <ul className="space-y-2">
        {(Object.keys(labels) as (keyof typeof labels)[])
          .filter(
            (key) => key !== "noOpenApplication" || value.purpose === "apply"
          )
          .map((key) => (
            <li
              key={key}
              className="flex flex-wrap items-baseline gap-x-2 text-ink"
            >
              <span className="font-bold">
                {value.checks[key] ? t("passed") : t("failed")}:
              </span>
              <span>{labels[key]}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
