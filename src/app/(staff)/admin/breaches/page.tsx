import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
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
import { BreachFields } from "./_components/breach-fields";
import { BreachOutcomeNotice } from "./_components/outcome-notice";
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
  const call = await adminCall(() => as(actor).listBreaches(), ADMIN_BREACHES);
  if (!call.ok) return <BreachAccessState state="denied" />;

  const { breaches, more } = call.value;
  const t = await getTranslations("adminBreaches");
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={t("title")} />
      <InPageLink
        href="#record-breach"
        className="w-fit font-semibold text-link underline underline-offset-4"
      >
        {t("forms.record")}
      </InPageLink>
      <BreachOutcomeNotice search={await searchParams} />
      {breaches.length ? (
        <BreachTable breaches={breaches} />
      ) : (
        <p>{t("empty")}</p>
      )}
      {more ? (
        <p className="text-sm text-ink-muted">
          {t("more", { count: breaches.length })}
        </p>
      ) : null}
      <div
        id="record-breach"
        className="max-w-2xl rounded-3xl border-2 border-border bg-surface p-5 sm:p-6"
      >
        <SectionHeading id="record-breach-title" title={t("forms.record")} />
        <form
          aria-labelledby="record-breach-title"
          action={recordBreachAction}
          className="mt-5 flex flex-col gap-4"
        >
          <BreachFields />
          <SubmitButton
            className="self-start"
            pendingLabel={t("forms.pending")}
          >
            {t("forms.recordSubmit")}
          </SubmitButton>
        </form>
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
