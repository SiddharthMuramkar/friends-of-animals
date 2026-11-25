import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
export type Query = Record<string, string | string[] | undefined>;
const outcomes = [
  "locked",
  "tagged",
  "round_not_open",
  "round_not_locked",
  "no_assignments",
  "unscored_assignments",
  "override_reason_invalid",
  "invalid_outcomes",
  "created",
  "saved",
  "opened",
  "cancelled",
  "invited",
  "revoked",
  "removed",
  "flagged",
  "invalid_input",
  "rubric_missing",
  "name_taken",
  "round_not_editable",
  "pool_not_empty",
  "round_transition_not_allowed",
  "reason_required",
  "not_found",
  "round_closed",
  "judge_not_ready",
  "already_judge",
  "forbidden",
  "second_factor_required",
  "failed",
] as const;
const count = (q: Query, key: string) =>
  typeof q[key] === "string" && /^\d{1,10}$/.test(q[key]) ? Number(q[key]) : 0;
export async function Outcome({
  query,
}: {
  query: Query;
}): Promise<JSX.Element | null> {
  const t = await getTranslations("adminJudging");
  if (query.done === "admitted")
    return (
      <output>
        {t("admittedOutcome", {
          count: count(query, "count"),
          refused: count(query, "refused"),
        })}
        <ul className="ms-6 list-disc">
          <li>{t("refusedPhysical", { count: count(query, "physical") })}</li>
          <li>
            {t("refusedVerification", { count: count(query, "verification") })}
          </li>
        </ul>
      </output>
    );
  if (query.done === "assigned")
    return (
      <output>
        {t("assignedOutcome", {
          count: count(query, "count"),
          conflicts: count(query, "conflicts"),
          duplicates: count(query, "duplicates"),
        })}
      </output>
    );
  const code = outcomes.find((o) => o === query.done);
  return code ? (
    <output className="font-semibold">{t(`outcomes.${code}`)}</output>
  ) : null;
}
