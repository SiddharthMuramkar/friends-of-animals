import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import {
  ADMIN_REPORTS,
  adminCompetitionReportPath,
  adminCompetitionReportCsvPath,
} from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import {
  REPORT_METRICS,
  type CompetitionReport,
  type MetricTotals,
} from "@/server/modules/reports/competition-report";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { AdminDenied } from "../../../_components/admin-denied";
import { adminCall } from "../../../_lib/boundary";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminReports");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const COL = "px-4 py-3 text-left";
const NUMBER = "px-4 py-3 text-right tabular-nums whitespace-nowrap";
const ROW = "border-t border-border";
const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover";

async function ReportTables({ report }: { report: CompetitionReport }) {
  const [t, formatter] = await Promise.all([
    getTranslations("adminReports"),
    getFormatter(),
  ]);
  const cells = (totals: MetricTotals) =>
    REPORT_METRICS.map((metric) => (
      <td key={metric} className={NUMBER}>
        {totals[metric] === null ? "—" : formatter.number(totals[metric])}
      </td>
    ));
  return (
    <>
      <p className="mt-6 text-ink-muted">{t("metricsHint")}</p>
      <TableScroller captionId="participation-report-caption" className="mt-4">
        <table className="w-full border-collapse text-left">
          <caption
            id="participation-report-caption"
            className="p-4 text-left text-lead font-bold"
          >
            {t("metricsTitle")}
          </caption>
          <thead className="bg-surface-muted">
            <tr>
              <th scope="col" className={COL}>
                {t("route")}
              </th>
              <th scope="col" className={COL}>
                {t("ageGroup")}
              </th>
              {REPORT_METRICS.map((metric) => (
                <th key={metric} scope="col" className={NUMBER}>
                  {t(metric)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={`${row.route}:${row.ageGroupId}`} className={ROW}>
                <th scope="row" className={COL}>
                  {t(row.route)}
                </th>
                <td className={COL}>{row.ageGroupLabel}</td>
                {cells(row)}
              </tr>
            ))}
            {report.routeTotals.map((row) => (
              <tr key={row.route} className={`${ROW} font-semibold`}>
                <th scope="row" className={COL}>
                  {t(row.route)}
                </th>
                <td className={COL}>{t("allAges")}</td>
                {cells(row.totals)}
              </tr>
            ))}
            {report.ageGroupTotals.map((row) => (
              <tr key={row.ageGroupId} className={`${ROW} font-semibold`}>
                <th scope="row" className={COL}>
                  {t("allRoutes")}
                </th>
                <td className={COL}>{row.ageGroupLabel}</td>
                {cells(row.totals)}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface-muted font-bold">
            <tr className={ROW}>
              <th scope="row" className={COL}>
                {t("allRoutes")}
              </th>
              <td className={COL}>{t("allAges")}</td>
              {cells(report.total)}
            </tr>
          </tfoot>
        </table>
      </TableScroller>
      {report.rows.length === 0 ? (
        <p className="mt-3">{t("noAgeGroups")}</p>
      ) : null}
      <p className="mt-3 text-ink-muted">{t("notApplicable")}</p>
      <p className="mt-8 text-ink-muted">{t("feesHint")}</p>
      <TableScroller captionId="fees-report-caption" className="mt-4">
        <table className="w-full border-collapse text-left">
          <caption
            id="fees-report-caption"
            className="p-4 text-left text-lead font-bold"
          >
            {t("feesTitle")}
          </caption>
          <thead className="bg-surface-muted">
            <tr>
              <th scope="col" className={COL}>
                {t("route")}
              </th>
              <th scope="col" className={NUMBER}>
                {t("captured")}
              </th>
              <th scope="col" className={NUMBER}>
                {t("refunded")}
              </th>
              <th scope="col" className={NUMBER}>
                {t("net")}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.fees.routes.map(({ route, totals }) => (
              <tr key={route} className={ROW}>
                <th scope="row" className={COL}>
                  {t(route)}
                </th>
                <td className={NUMBER}>{formatPaise(totals.capturedMinor)}</td>
                <td className={NUMBER}>{formatPaise(totals.refundedMinor)}</td>
                <td className={NUMBER}>{formatPaise(totals.netMinor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface-muted font-bold">
            <tr className={ROW}>
              <th scope="row" className={COL}>
                {t("allRoutes")}
              </th>
              <td className={NUMBER}>
                {formatPaise(report.fees.total.capturedMinor)}
              </td>
              <td className={NUMBER}>
                {formatPaise(report.fees.total.refundedMinor)}
              </td>
              <td className={NUMBER}>
                {formatPaise(report.fees.total.netMinor)}
              </td>
            </tr>
          </tfoot>
        </table>
      </TableScroller>
    </>
  );
}

export default async function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const [{ code }, t, actor] = await Promise.all([
    params,
    getTranslations("adminReports"),
    currentActor(),
  ]);
  const call = await adminCall(
    () => as(actor).getCompetitionReport({ competitionCode: code }),
    adminCompetitionReportPath(code)
  );
  if (!call.ok)
    return (
      <Section width="wide" className="pt-10 sm:pt-14">
        <PageHeader title={t("title")} />
        <AdminDenied />
      </Section>
    );
  if (!call.value.ok) notFound();
  const report = call.value.report;
  return (
    <Section width="wide" className="pt-10 sm:pt-14">
      <SiteLink href={ADMIN_REPORTS} className={LINK}>
        {t("back")}
      </SiteLink>
      <PageHeader
        title={t("reportTitle", { name: report.competition.name })}
        lead={report.competition.code}
        className="mt-4"
      />
      <a className={`${LINK} mt-3`} href={adminCompetitionReportCsvPath(code)}>
        {t("download")}
      </a>
      <p className="text-ink-muted">{t("downloadHint")}</p>
      <ReportTables report={report} />
    </Section>
  );
}
