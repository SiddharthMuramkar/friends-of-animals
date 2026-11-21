import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { InstitutionStatusChip } from "@/components/institutions/status-chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { adminInstitutionPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { as, currentActor } from "@/server/app";
import type { InstitutionSummary } from "@/server/modules/institutions";

import { filterHref, STATUS_FILTERS, statusFilter } from "./_lib/filter";
import { isForbidden } from "./_lib/refused";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminInstitutions.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = PageProps<"/admin/institutions">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/admin/institutions">) {
  const t = await getTranslations("adminInstitutions");
  return (
    <Section hue="neutral" width="default" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="teal"
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

const TAB =
  "inline-flex min-h-11 items-center rounded-full border-2 px-4 font-semibold";

const CELL = "px-4 py-3 text-start align-top";

async function Queue({ searchParams }: { searchParams: SearchParams }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, statuses, types, format, { status }] = await Promise.all([
    getTranslations("adminInstitutions"),
    getTranslations("institutions.status"),
    getTranslations("institutions.type"),
    getFormatter(),
    searchParams,
  ]);
  const filter = statusFilter(status);

  let institutions: InstitutionSummary[];
  try {
    const result = await as(actor).listInstitutions(
      filter === "all" ? {} : { status: filter }
    );
    // The filter only ever passes a known status.
    institutions = result.ok ? result.institutions : [];
  } catch (error) {
    if (!isForbidden(error)) throw error;
    return (
      <ExplainState
        className="mt-8"
        title={t("forbidden.title")}
        back={{ href: ROUTES.home.path, label: t("forbidden.back") }}
      >
        <p>{t("forbidden.body")}</p>
      </ExplainState>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      <nav aria-label={t("filter.label")}>
        <ul className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((each) => {
            const current = each === filter;
            return (
              <li key={each}>
                <SiteLink
                  href={filterHref(each)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    TAB,
                    current
                      ? "border-ink bg-ink text-background"
                      : "border-border-strong bg-surface text-ink hover:border-ink"
                  )}
                >
                  {each === "all" ? t("filter.all") : statuses(each)}
                </SiteLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {institutions.length === 0 ? (
        <p className="text-ink-muted">{t("empty")}</p>
      ) : (
        <TableScroller captionId="institutions-caption">
          <table className="w-full min-w-[44rem] border-collapse text-body">
            <caption id="institutions-caption" className="sr-only">
              {t("table.caption")}
            </caption>
            <thead className="border-b-2 border-border bg-surface-muted">
              <tr>
                <th scope="col" className={CELL}>
                  {t("table.name")}
                </th>
                <th scope="col" className={CELL}>
                  {t("table.type")}
                </th>
                <th scope="col" className={CELL}>
                  {t("table.place")}
                </th>
                <th scope="col" className={CELL}>
                  {t("table.status")}
                </th>
                <th scope="col" className={CELL}>
                  {t("table.institutionId")}
                </th>
                <th scope="col" className={CELL}>
                  {t("table.registered")}
                </th>
              </tr>
            </thead>
            <tbody>
              {institutions.map((institution) => (
                <tr
                  key={institution.id}
                  className="border-b border-border last:border-b-0"
                >
                  <th scope="row" className={cn(CELL, "font-semibold")}>
                    <SiteLink
                      href={adminInstitutionPath(institution.id)}
                      className="inline-flex min-h-6 items-center text-link underline decoration-2 underline-offset-4 hover:text-link-hover"
                    >
                      {institution.name}
                    </SiteLink>
                  </th>
                  <td className={CELL}>{types(institution.type)}</td>
                  <td className={CELL}>
                    {t("table.place_value", {
                      city: institution.city,
                      state: institution.state,
                    })}
                  </td>
                  <td className={CELL}>
                    <InstitutionStatusChip
                      status={institution.status}
                      label={statuses(institution.status)}
                    />
                  </td>
                  <td className={cn(CELL, "whitespace-nowrap")}>
                    {institution.institutionCode ?? t("table.noId")}
                  </td>
                  <td className={cn(CELL, "whitespace-nowrap")}>
                    {format.dateTime(institution.registeredAt, "long")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
    </div>
  );
}
