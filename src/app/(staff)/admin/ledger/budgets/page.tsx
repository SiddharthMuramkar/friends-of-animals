import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { FormAlert } from "@/components/form/form-alert";
import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { ButtonLink } from "@/components/site/button-link";
import { TableScroller } from "@/components/site/table-scroller";
import {
  ADMIN_LEDGER_BUDGET_REPORT,
  ADMIN_LEDGER_BUDGETS,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { as, currentActor } from "@/server/app";
import { periodMonthOf } from "@/server/modules/ledger/domain/period";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

import { adminCall } from "../../_lib/boundary";
import { LedgerDenied } from "../_components/denied";
import { LedgerFrame } from "../_components/frame";
import { setBudgetAction } from "../_lib/budget-actions";
import { monthLabel, shortMonthLabel } from "../_lib/month";
import { reportError } from "../_lib/report-outcome";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminLedgerReports.budgets");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const cell = "px-3 py-2 align-top";
const number = cn(cell, "text-right whitespace-nowrap tabular-nums");

/** The financial year starting in April of `fy`, or the current one. */
function yearOf(fy: unknown, now: Date) {
  if (typeof fy === "string" && /^\d{4}$/.test(fy)) return Number(fy);
  const [year, month] = periodMonthOf(now).split("-").map(Number) as [
    number,
    number,
  ];
  return month >= 4 ? year : year - 1;
}

export default async function Page({
  searchParams,
}: PageProps<"/admin/ledger/budgets">) {
  const [actor, t, ledger, format] = await Promise.all([
    currentActor(),
    getTranslations("adminLedgerReports"),
    getTranslations("adminLedger"),
    getFormatter(),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const search = await searchParams;
  const fy = yearOf(search.fy, new Date());
  const from = `${fy}-04`;
  const to = `${fy + 1}-03`;
  const use = as(actor);
  const result = await adminCall(
    () =>
      Promise.all([use.budgetVsActual({ from, to }), use.listLedgerAccounts()]),
    ADMIN_LEDGER_BUDGETS
  );
  if (!result.ok) return <LedgerDenied title={t("budgets.title")} />;
  const [report, accounts] = result.value;
  const error = await reportError(search.error);
  const range = t("budgets.year", {
    from: monthLabel(format, from),
    to: monthLabel(format, to),
  });
  const categories = accounts
    .filter(
      ({ kind, isActive }) =>
        isActive && (kind === "income" || kind === "expense")
    )
    .map(({ code, name }) => ({ value: code, label: `${code} ${name}` }));

  return (
    <LedgerFrame title={t("budgets.title")} back={ledger("back")}>
      {search.done === "budget_saved" ? (
        <FormAlert tone="success" label={t("budgets.formTitle")}>
          <p>{t("results.budget_saved")}</p>
        </FormAlert>
      ) : null}
      {error ? (
        <FormAlert tone="danger" label={t("budgets.formTitle")}>
          <p>{error}</p>
        </FormAlert>
      ) : null}
      <p className="max-w-prose">{t("budgets.lead")}</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink
          href={`${ADMIN_LEDGER_BUDGET_REPORT}?from=${from}&to=${to}`}
          variant="secondary"
        >
          {t("budgets.report")}
        </ButtonLink>
        <ButtonLink
          href={`${ADMIN_LEDGER_BUDGETS}?fy=${fy - 1}`}
          variant="quiet"
        >
          {t("budgets.previousYear")}
        </ButtonLink>
        <ButtonLink
          href={`${ADMIN_LEDGER_BUDGETS}?fy=${fy + 1}`}
          variant="quiet"
        >
          {t("budgets.nextYear")}
        </ButtonLink>
      </div>
      <section aria-labelledby="budget-form-title" className="space-y-4">
        <h2 id="budget-form-title" className="text-h3 font-semibold">
          {t("budgets.formTitle")}
        </h2>
        <form action={setBudgetAction} className="space-y-4">
          <input type="hidden" name="fy" value={String(fy)} />
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              id="budget-category"
              name="accountCode"
              label={t("budgets.category")}
              options={categories}
              placeholder={t("budgets.chooseCategory")}
              required
            />
            <SelectField
              id="budget-month"
              name="periodMonth"
              label={t("budgets.month")}
              options={
                report.ok
                  ? report.months.map((month) => ({
                      value: month,
                      label: monthLabel(format, month),
                    }))
                  : []
              }
              placeholder={t("budgets.chooseMonth")}
              required
            />
            <TextField
              id="budget-amount"
              name="amount"
              label={t("budgets.amount")}
              hint={t("budgets.amountHint")}
              inputMode="decimal"
              autoComplete="off"
            />
          </div>
          <SubmitButton pendingLabel={t("budgets.saving")}>
            {t("budgets.save")}
          </SubmitButton>
        </form>
      </section>
      {report.ok ? (
        <section aria-labelledby="budget-table-title" className="space-y-4">
          <h2 id="budget-table-title" className="text-h3 font-semibold">
            {t("budgets.tableTitle", { range })}
          </h2>
          <TableScroller captionId="budget-table-caption">
            <table className="w-full text-left text-sm">
              <caption id="budget-table-caption" className="sr-only">
                {t("budgets.caption")}
              </caption>
              <thead className="bg-surface-muted">
                <tr>
                  <th scope="col" className={cell}>
                    {t("budgets.categoryColumn")}
                  </th>
                  {report.months.map((month) => (
                    <th key={month} scope="col" className={number}>
                      {shortMonthLabel(format, month)}
                    </th>
                  ))}
                  <th scope="col" className={number}>
                    {t("budgets.total")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.rows.map((row) => (
                  <tr key={row.account.id}>
                    <th scope="row" className={cn(cell, "min-w-40")}>
                      {row.account.code} {row.account.name}
                      {row.isActive ? null : (
                        <span className="block text-ink-muted">
                          {t("budgets.inactive")}
                        </span>
                      )}
                    </th>
                    {row.months.map((month) => (
                      <td key={month.periodMonth} className={number}>
                        {month.budgetMinor === null
                          ? t("budgets.none")
                          : formatPaise(month.budgetMinor)}
                      </td>
                    ))}
                    <td className={cn(number, "font-semibold")}>
                      {row.total.budgetMinor === null
                        ? t("budgets.none")
                        : formatPaise(row.total.budgetMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </section>
      ) : null}
    </LedgerFrame>
  );
}
