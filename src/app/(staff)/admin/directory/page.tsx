import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ListingStatusChip } from "@/components/directory/listing-status-chip";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { adminDirectoryListingPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import {
  LISTING_STATUSES,
  type ListListingsForReviewResult,
} from "@/server/modules/directory";

import { afterFilter, filterHref, statusFilter } from "./_lib/filter";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminDirectory.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = PageProps<"/admin/directory">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/admin/directory">) {
  const t = await getTranslations("adminDirectory");
  return (
    <Section hue="neutral" width="default" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
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
  const [t, statuses, types, format, query] = await Promise.all([
    getTranslations("adminDirectory"),
    getTranslations("directory.status"),
    getTranslations("directory.type"),
    getFormatter(),
    searchParams,
  ]);
  const status = statusFilter(query.status);
  const after = afterFilter(query.after);

  let result: ListListingsForReviewResult;
  try {
    result = await as(actor).listListingsForReview({ status, after });
  } catch (error) {
    if (!(error instanceof DomainError && error.code === "forbidden")) {
      throw error;
    }
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
  // The filter only ever passes a known status and a well-formed cursor.
  const listings = result.ok ? result.listings : [];
  const next = result.ok ? result.next : null;

  return (
    <div className="mt-8 flex flex-col gap-6">
      <nav aria-label={t("filter.label")}>
        <ul className="flex flex-wrap gap-2">
          {LISTING_STATUSES.map((each) => {
            const current = each === status;
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
                  {statuses(each)}
                </SiteLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {listings.length === 0 ? (
        <p className="text-ink-muted">{t("empty")}</p>
      ) : (
        <TableScroller captionId="listings-caption">
          <table className="w-full min-w-[40rem] border-collapse text-body">
            <caption id="listings-caption" className="sr-only">
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
                  {t("table.registered")}
                </th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr
                  key={listing.id}
                  className="border-b border-border last:border-b-0"
                >
                  <th scope="row" className={cn(CELL, "font-semibold")}>
                    <SiteLink
                      href={adminDirectoryListingPath(listing.id)}
                      className="inline-flex min-h-6 items-center text-link underline decoration-2 underline-offset-4 wrap-anywhere hover:text-link-hover"
                    >
                      {listing.name}
                    </SiteLink>
                  </th>
                  <td className={CELL}>{types(listing.type)}</td>
                  <td className={CELL}>
                    {t("table.place_value", {
                      city: listing.city,
                      state: listing.state,
                    })}
                  </td>
                  <td className={CELL}>
                    <ListingStatusChip
                      status={listing.status}
                      label={statuses(listing.status)}
                    />
                  </td>
                  <td className={cn(CELL, "whitespace-nowrap")}>
                    {format.dateTime(listing.registeredAt, "long")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
      <div className="flex flex-wrap gap-3">
        {after ? (
          <ButtonLink href={filterHref(status)} variant="secondary">
            {t("first")}
          </ButtonLink>
        ) : null}
        {next ? (
          <ButtonLink href={filterHref(status, next)} variant="secondary">
            {t("more")}
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}
