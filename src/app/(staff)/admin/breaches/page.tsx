import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { InPageLink } from "@/components/site/in-page-link";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { ADMIN_BREACHES, adminBreachPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { BreachListItem } from "@/server/modules/breaches/read";

import { adminCall } from "../_lib/boundary";
import { BreachAccessState } from "./_components/access-state";
import { BreachDetailsForm } from "./_components/breach-fields";
import { BreachOutcomeNotice } from "./_components/outcome-notice";
import { breachDetailsLabels } from "./_lib/details-labels";
import { recordBreachAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminBreaches");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function Page({
  searchParams,
}: PageProps<"/admin/breaches">) {
  const t = await getTranslations("adminBreaches");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <BreachLog searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function BreachLog({
  searchParams,
}: Pick<PageProps<"/admin/breaches">, "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const search = await searchParams;
  const call = await adminCall(
    () => as(actor).listBreaches({ cursor: search.cursor }),
    ADMIN_BREACHES
  );
  if (!call.ok) return <BreachAccessState state="denied" />;

  const { breaches, nextCursor } = call.value.ok
    ? call.value
    : { breaches: [], nextCursor: null };
  const [t, labels] = await Promise.all([
    getTranslations("adminBreaches"),
    breachDetailsLabels(),
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={t("title")} />
      <InPageLink
        href="#record-breach"
        className="w-fit font-semibold text-link underline underline-offset-4"
      >
        {t("forms.record")}
      </InPageLink>
      <BreachOutcomeNotice
        search={call.value.ok ? search : { done: "invalid_input" }}
      />
      {breaches.length ? (
        <BreachTable breaches={breaches} />
      ) : call.value.ok ? (
        <p>{t("empty")}</p>
      ) : null}
      {search.cursor !== undefined || nextCursor ? (
        <nav
          aria-label={t("pagination.label")}
          className="flex flex-wrap gap-3"
        >
          {search.cursor !== undefined ? (
            <ButtonLink href={ADMIN_BREACHES} variant="secondary">
              {t("pagination.first")}
            </ButtonLink>
          ) : null}
          {nextCursor ? (
            <ButtonLink
              href={`${ADMIN_BREACHES}?${new URLSearchParams({ cursor: nextCursor })}`}
              variant="secondary"
            >
              {t("pagination.older")}
            </ButtonLink>
          ) : null}
        </nav>
      ) : null}
      <div
        id="record-breach"
        className="max-w-2xl rounded-3xl border-2 border-border bg-surface p-5 sm:p-6"
      >
        <SectionHeading id="record-breach-title" title={t("forms.record")} />
        <BreachDetailsForm
          headingId="record-breach-title"
          action={recordBreachAction}
          labels={labels}
        />
      </div>
    </div>
  );
}

async function BreachTable({ breaches }: { breaches: BreachListItem[] }) {
  const [t, format] = await Promise.all([
    getTranslations("adminBreaches"),
    getFormatter(),
  ]);
  return (
    <TableScroller captionId="breaches-caption">
      <table className="w-full text-left">
        <caption id="breaches-caption" className="sr-only">
          {t("title")}
        </caption>
        <thead className="bg-surface-muted text-sm">
          <tr>
            {(["title", "status", "severity", "awareAt", "count"] as const).map(
              (field) => (
                <th key={field} scope="col" className="px-4 py-3">
                  {t(`fields.${field}`)}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {breaches.map((breach) => (
            <tr key={breach.id} className="border-t border-border">
              <th scope="row" className="min-w-44 px-4 py-3 wrap-anywhere">
                <SiteLink
                  href={adminBreachPath(breach.id)}
                  prefetch={false}
                  className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4"
                >
                  {breach.title}
                </SiteLink>
              </th>
              <td className="px-4 py-3">{t(`statuses.${breach.status}`)}</td>
              <td className="px-4 py-3">
                {t(`severities.${breach.severity}`)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <time dateTime={breach.awareAt.toISOString()}>
                  {format.dateTime(breach.awareAt, "dateTime")}
                </time>
              </td>
              <td className="px-4 py-3 tabular-nums">
                {format.number(breach.affectedCount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
