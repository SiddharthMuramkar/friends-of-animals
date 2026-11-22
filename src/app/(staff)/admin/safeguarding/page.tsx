import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { QueueItem, QueueView } from "@/server/modules/safeguarding";

import { adminCall } from "../_lib/boundary";
import { LeadDenied } from "./_components/lead-denied";
import { StatusChip } from "./_components/status-chip";
import { reportHref } from "./_lib/outcome";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSafeguarding.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/**
 * The safeguarding lead's queue (#116): open reports by default, resolved
 * ones with `?view=resolved`. It shows no free text, so a glance over a
 * lead's shoulder exposes no report. Every view is audited.
 */
export default async function Page({
  searchParams,
}: PageProps<"/admin/safeguarding">) {
  const t = await getTranslations("adminSafeguarding");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="red"
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Queue searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Queue({
  searchParams,
}: {
  searchParams: PageProps<"/admin/safeguarding">["searchParams"];
}) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const view: QueueView =
    (await searchParams).view === "resolved" ? "resolved" : "open";
  const here =
    view === "resolved"
      ? `${APP_ROUTES.adminSafeguarding}?view=resolved`
      : APP_ROUTES.adminSafeguarding;
  const call = await adminCall(
    () => as(actor).listSafeguardingReports({ view }),
    here
  );
  if (!call.ok) return <LeadDenied />;
  // The view was normalised above, so the use case can't find it invalid.
  if (!call.value.ok)
    throw new Error("The safeguarding queue refused its view");
  const { reports, more } = call.value;
  const t = await getTranslations("adminSafeguarding");

  return (
    <div className="mt-8 flex flex-col gap-6">
      <nav aria-label={t("views.label")}>
        <ul className="flex flex-wrap gap-2">
          {(["open", "resolved"] as const).map((option) => (
            <li key={option}>
              <SiteLink
                href={
                  option === "resolved"
                    ? `${APP_ROUTES.adminSafeguarding}?view=resolved`
                    : APP_ROUTES.adminSafeguarding
                }
                aria-current={option === view ? "page" : undefined}
                className="inline-flex min-h-11 items-center rounded-full border-2 border-border-strong bg-surface px-4 py-1.5 font-semibold text-ink hover:border-ink aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-surface"
              >
                {t(`views.${option}`)}
              </SiteLink>
            </li>
          ))}
        </ul>
      </nav>
      {reports.length === 0 ? (
        <p className="text-ink-muted">{t(`empty.${view}`)}</p>
      ) : (
        <ReportTable reports={reports} view={view} />
      )}
      {more ? (
        <p className="text-sm text-ink-muted">
          {t("more", { count: reports.length })}
        </p>
      ) : null}
    </div>
  );
}

async function ReportTable({
  reports,
  view,
}: {
  reports: QueueItem[];
  view: QueueView;
}) {
  const [t, format] = await Promise.all([
    getTranslations("adminSafeguarding"),
    getFormatter(),
  ]);
  const head = "px-4 py-3 whitespace-nowrap";
  const cell = "px-4 py-3 align-top";
  return (
    <TableScroller captionId="reports-caption">
      <table className="w-full text-left">
        <caption id="reports-caption" className="sr-only">
          {t("table.caption", { view })}
        </caption>
        <thead className="bg-surface-muted text-sm">
          <tr>
            <th scope="col" className={head}>
              {t("table.reference")}
            </th>
            <th scope="col" className={head}>
              {t("table.category")}
            </th>
            <th scope="col" className={head}>
              {t("table.severity")}
            </th>
            <th scope="col" className={head}>
              {t("table.status")}
            </th>
            <th scope="col" className={head}>
              {t("table.assignee")}
            </th>
            <th scope="col" className={head}>
              {t("table.received")}
            </th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr key={report.id} className="border-t border-border">
              <th scope="row" className={cell}>
                <SiteLink
                  href={reportHref(report.id)}
                  className={`${LINK} font-mono`}
                >
                  {report.reference}
                </SiteLink>
              </th>
              <td className={cell}>
                {t(`categories.${report.category}`)}
                {report.reporterIsChild ? (
                  <span className="block text-sm text-ink-muted">
                    {t("childReporter")}
                  </span>
                ) : null}
              </td>
              <td className={cell}>
                {t(`severities.${report.severity ?? "none"}`)}
              </td>
              <td className={cell}>
                <StatusChip status={report.status} />
              </td>
              <td className={cell}>{report.assignedTo?.name ?? t("nobody")}</td>
              <td className={`${cell} whitespace-nowrap`}>
                <time dateTime={report.createdAt.toISOString()}>
                  {format.dateTime(report.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
