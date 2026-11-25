import { CircleAlert, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { FormAlert } from "@/components/form/form-alert";
import { TextField } from "@/components/form/text-field";
import { buttonStyles } from "@/components/site/button-link";
import { TableScroller } from "@/components/site/table-scroller";
import { ADMIN_LEDGER_BUDGET_REPORT } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { as, currentActor, type UseCases } from "@/server/app";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

import { adminCall } from "../../../_lib/boundary";
import { LedgerDenied } from "../../_components/denied";
import { LedgerFrame } from "../../_components/frame";
import { monthLabel } from "../../_lib/month";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminLedgerReports.report");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Report = Extract<
  Awaited<ReturnType<UseCases["budgetVsActual"]>>,
  { ok: true }
>;
type Comparison = Report["rows"][number]["total"];

const cell = "px-3 py-2 align-top";
const number = cn(cell, "text-right whitespace-nowrap tabular-nums");

export default async function Page({
  searchParams,
}: PageProps<"/admin/ledger/budgets/report">) {
  const [actor, t, ledger] = await Promise.all([
    currentActor(),
    getTranslations("adminLedgerReports"),
    getTranslations("adminLedger"),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const search = await searchParams;
  const one = (key: string) =>
    typeof search[key] === "string" ? search[key] : undefined;
  const filters = { from: one("from"), to: one("to") };
  const result = await adminCall(
    () => as(actor).budgetVsActual(filters),
    ADMIN_LEDGER_BUDGET_REPORT
  );
  if (!result.ok) return <LedgerDenied title={t("report.title")} />;
  const report = result.value;

  return (
    <LedgerFrame title={t("report.title")} back={ledger("back")}>
      <p className="max-w-prose">{t("report.lead")}</p>
      <search>
        <form
          action={ADMIN_LEDGER_BUDGET_REPORT}
          method="get"
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="report-from"
              name="from"
              type="month"
              label={t("report.from")}
              hint={t("report.monthHint")}
              defaultValue={report.ok ? report.months[0] : filters.from}
            />
            <TextField
              id="report-to"
              name="to"
              type="month"
              label={t("report.to")}
              hint={t("report.monthHint")}
              defaultValue={report.ok ? report.months.at(-1) : filters.to}
            />
          </div>
          <button
            type="submit"
            className={buttonStyles({ variant: "secondary" })}
          >
            {t("report.apply")}
          </button>
        </form>
      </search>
      {report.ok ? (
        <ReportTables report={report} />
      ) : (
        <FormAlert tone="danger" label={t("report.title")}>
          <p>{t(`errors.${report.error}`)}</p>
        </FormAlert>
      )}
    </LedgerFrame>
  );
}

async function ReportTables({ report }: { report: Report }) {
  const [t, format] = await Promise.all([
    getTranslations("adminLedgerReports.report"),
    getFormatter(),
  ]);
  const first = report.months[0]!;
  const last = report.months.at(-1)!;
  const percent = (value: number | null) =>
    value === null
      ? ""
      : t("usedPercent", {
          percent: format.number(value, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
        });
  const money = (value: bigint | null) =>
    value === null ? "" : formatPaise(value);
  const status = (comparison: Comparison) =>
    comparison.favourable === null ? (
      <span className="text-ink-muted">{t("noBudget")}</span>
    ) : comparison.favourable ? (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <CircleCheck aria-hidden="true" className="size-4 text-success" />
        {t("favourable")}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold">
        <CircleAlert aria-hidden="true" className="size-4 text-danger" />
        {t("unfavourable")}
      </span>
    );
  const kinds = ["income", "expense"] as const;

  return (
    <>
      <p className="font-semibold">
        {t("range", {
          from: monthLabel(format, first),
          to: monthLabel(format, last),
        })}
      </p>
      <section aria-labelledby="report-categories" className="space-y-4">
        <h2 id="report-categories" className="text-h3 font-semibold">
          {t("categoriesTitle")}
        </h2>
        <TableScroller captionId="report-categories-caption">
          <table className="w-full text-left text-sm">
            <caption id="report-categories-caption" className="sr-only">
              {t("categoriesCaption")}
            </caption>
            <thead className="bg-surface-muted">
              <tr>
                <th scope="col" className={cell}>
                  {t("category")}
                </th>
                <th scope="col" className={number}>
                  {t("budget")}
                </th>
                <th scope="col" className={number}>
                  {t("actual")}
                </th>
                <th scope="col" className={number}>
                  {t("variance")}
                </th>
                <th scope="col" className={number}>
                  {t("used")}
                </th>
                <th scope="col" className={cell}>
                  {t("status")}
                </th>
              </tr>
            </thead>
            {kinds.map((kind) => (
              <tbody key={kind} className="divide-y divide-border">
                <tr className="bg-surface-muted/50">
                  <th scope="colgroup" colSpan={6} className={cell}>
                    {t(`kinds.${kind}`)}
                  </th>
                </tr>
                {report.rows
                  .filter(({ account }) => account.kind === kind)
                  .map((row) => (
                    <tr key={row.account.id}>
                      <th scope="row" className={cn(cell, "min-w-40")}>
                        {row.account.code} {row.account.name}
                      </th>
                      <td className={number}>{money(row.total.budgetMinor)}</td>
                      <td className={number}>{money(row.total.actualMinor)}</td>
                      <td className={number}>
                        {money(row.total.varianceMinor)}
                      </td>
                      <td className={number}>
                        {percent(row.total.usedPercent)}
                      </td>
                      <td className={cell}>{status(row.total)}</td>
                    </tr>
                  ))}
                <tr className="font-semibold">
                  <th scope="row" className={cell}>
                    {t(`totals.${kind}`)}
                  </th>
                  <td className={number}>
                    {money(report.totals[kind].total.budgetMinor)}
                  </td>
                  <td className={number}>
                    {money(report.totals[kind].total.actualMinor)}
                  </td>
                  <td className={number}>
                    {money(
                      report.totals[kind].total.actualMinor -
                        report.totals[kind].total.budgetMinor
                    )}
                  </td>
                  <td className={number}>–</td>
                  <td className={cell}>–</td>
                </tr>
              </tbody>
            ))}
            <tfoot className="border-t-2 border-border font-semibold">
              <tr>
                <th scope="row" className={cell}>
                  {t("totals.net")}
                </th>
                <td className={number}>
                  {money(report.totals.net.total.budgetMinor)}
                </td>
                <td className={number}>
                  {money(report.totals.net.total.actualMinor)}
                </td>
                <td className={number}>
                  {money(
                    report.totals.net.total.actualMinor -
                      report.totals.net.total.budgetMinor
                  )}
                </td>
                <td className={number}>–</td>
                <td className={cell}>–</td>
              </tr>
            </tfoot>
          </table>
        </TableScroller>
      </section>
      <section aria-labelledby="report-months" className="space-y-4">
        <h2 id="report-months" className="text-h3 font-semibold">
          {t("monthsTitle")}
        </h2>
        <TableScroller captionId="report-months-caption">
          <table className="w-full text-left text-sm">
            <caption id="report-months-caption" className="sr-only">
              {t("monthsCaption")}
            </caption>
            <thead className="bg-surface-muted">
              <tr>
                <th scope="col" className={cell}>
                  {t("month")}
                </th>
                <th scope="col" className={number}>
                  {t("incomeBudget")}
                </th>
                <th scope="col" className={number}>
                  {t("incomeActual")}
                </th>
                <th scope="col" className={number}>
                  {t("expenseBudget")}
                </th>
                <th scope="col" className={number}>
                  {t("expenseActual")}
                </th>
                <th scope="col" className={number}>
                  {t("netActual")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.months.map((month, index) => {
                const income = report.totals.income.months[index]!;
                const expense = report.totals.expense.months[index]!;
                const net = report.totals.net.months[index]!;
                return (
                  <tr key={month}>
                    <th scope="row" className={cn(cell, "whitespace-nowrap")}>
                      {monthLabel(format, month)}
                    </th>
                    <td className={number}>{money(income.budgetMinor)}</td>
                    <td className={number}>{money(income.actualMinor)}</td>
                    <td className={number}>{money(expense.budgetMinor)}</td>
                    <td className={number}>{money(expense.actualMinor)}</td>
                    <td className={number}>{money(net.actualMinor)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroller>
      </section>
    </>
  );
}
