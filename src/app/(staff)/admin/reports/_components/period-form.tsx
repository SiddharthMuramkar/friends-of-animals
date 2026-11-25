import { getTranslations } from "next-intl/server";
import { TextField } from "@/components/form/text-field";
import { buttonStyles } from "@/components/site/button-link";
import { istDateOf } from "@/server/modules/ledger/domain/period";
import type { ObjectivePeriodInput } from "@/server/modules/reports/domain/period";

export function periodFromQuery(
  query: Record<string, string | string[] | undefined>
) {
  const now = new Date();
  const earlier = new Date(now.getTime() - 183 * 86400000);
  const one = (key: string, fallback: string) =>
    query[key] === undefined
      ? fallback
      : typeof query[key] === "string"
        ? query[key]
        : "";
  return {
    from: one("from", istDateOf(earlier)),
    to: one("to", istDateOf(now)),
  };
}

export function periodUrl(path: string, period: ObjectivePeriodInput) {
  return `${path}?${new URLSearchParams(period)}`;
}

export async function PeriodForm({
  path,
  period,
}: {
  path: string;
  period: ObjectivePeriodInput;
}) {
  const t = await getTranslations("objectiveReports");
  return (
    <search className="mt-8 max-w-2xl">
      <form
        action={path}
        method="get"
        aria-labelledby="report-period-label"
        className="space-y-4"
      >
        <h2 id="report-period-label">{t("period")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="report-from"
            className="min-w-0"
            name="from"
            label={t("from")}
            type="date"
            required
            defaultValue={period.from}
          />
          <TextField
            id="report-to"
            className="min-w-0"
            name="to"
            label={t("to")}
            type="date"
            required
            defaultValue={period.to}
          />
        </div>
        <button
          type="submit"
          className={buttonStyles({ variant: "secondary" })}
        >
          {t("apply")}
        </button>
      </form>
    </search>
  );
}
