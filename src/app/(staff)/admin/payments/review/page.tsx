import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Chip } from "@/components/site/chip";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { adminPaymentReviewCasePath, APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { PaymentReviewCaseItem } from "@/server/modules/payments";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

import { adminCall } from "../../_lib/boundary";
import { PaymentsDenied } from "../_components/payments-denied";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminPayments.review.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

type View = "open" | "resolved";

const viewHref = (view: View) =>
  view === "resolved"
    ? `${APP_ROUTES.adminPaymentsReview}?view=resolved`
    : APP_ROUTES.adminPaymentsReview;

/**
 * Payments needing review (#79): money the gateway captured that its batch
 * couldn't accept, open by default, resolved ones with `?view=resolved`.
 * Finance, staff admins and super admins.
 */
export default async function Page({
  searchParams,
}: PageProps<"/admin/payments/review">) {
  const t = await getTranslations("adminPayments");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="yellow"
        title={t("review.title")}
        lead={t("review.lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Cases searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Cases({
  searchParams,
}: {
  searchParams: PageProps<"/admin/payments/review">["searchParams"];
}) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const view: View =
    (await searchParams).view === "resolved" ? "resolved" : "open";
  const call = await adminCall(
    () => as(actor).listPaymentReviewCases({ state: view }),
    viewHref(view)
  );
  if (!call.ok) return <PaymentsDenied />;
  // The view was normalised above, so the use case can't find it invalid.
  if (!call.value.ok) throw new Error("The review list refused its view");
  const { cases } = call.value;
  const t = await getTranslations("adminPayments.review");

  return (
    <div className="mt-8 flex flex-col gap-6">
      <nav aria-label={t("views.label")}>
        <ul className="flex flex-wrap gap-2">
          {(["open", "resolved"] as const).map((option) => (
            <li key={option}>
              <SiteLink
                href={viewHref(option)}
                aria-current={option === view ? "page" : undefined}
                className="inline-flex min-h-11 items-center rounded-full border-2 border-border-strong bg-surface px-4 py-1.5 font-semibold text-ink hover:border-ink aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-surface"
              >
                {t(`views.${option}`)}
              </SiteLink>
            </li>
          ))}
        </ul>
      </nav>
      {cases.length === 0 ? (
        <p className="text-ink-muted">{t(`empty.${view}`)}</p>
      ) : (
        <CaseTable cases={cases} view={view} />
      )}
    </div>
  );
}

async function CaseTable({
  cases,
  view,
}: {
  cases: PaymentReviewCaseItem[];
  view: View;
}) {
  const [t, format] = await Promise.all([
    getTranslations("adminPayments"),
    getFormatter(),
  ]);
  const head = "px-4 py-3 whitespace-nowrap";
  const cell = "px-4 py-3 align-top";
  return (
    <TableScroller captionId="review-caption">
      <table className="w-full text-left">
        <caption id="review-caption" className="sr-only">
          {t("review.table.caption", { view })}
        </caption>
        <thead className="bg-surface-muted text-sm">
          <tr>
            <th scope="col" className={head}>
              {t("review.table.payment")}
            </th>
            <th scope="col" className={head}>
              {t("review.table.payer")}
            </th>
            <th scope="col" className={head}>
              {t("review.table.competition")}
            </th>
            <th scope="col" className={head}>
              {t("review.table.reason")}
            </th>
            <th scope="col" className={head}>
              {t("review.table.opened")}
            </th>
            {view === "resolved" ? (
              <th scope="col" className={head}>
                {t("review.table.resolution")}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {cases.map((each) => {
            const amount = formatPaise(each.amountMinor);
            const payer = each.payer?.name ?? t("payer.unknown");
            return (
              <tr key={each.id} className="border-t border-border">
                <th scope="row" className={cell}>
                  <SiteLink
                    href={adminPaymentReviewCasePath(each.id)}
                    className={LINK}
                    aria-label={t("review.table.open", { amount, payer })}
                  >
                    {amount}
                  </SiteLink>
                </th>
                <td className={`${cell} wrap-anywhere`}>{payer}</td>
                <td className={`${cell} wrap-anywhere`}>
                  {each.competitionName}
                </td>
                <td className={cell}>{t(`reasons.${each.reason}`)}</td>
                <td className={`${cell} whitespace-nowrap`}>
                  <time dateTime={each.openedAt.toISOString()}>
                    {format.dateTime(each.openedAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </td>
                {view === "resolved" ? (
                  <td className={cell}>
                    {each.resolution ? (
                      <Chip
                        tone={
                          each.resolution.outcome === "confirm"
                            ? "green"
                            : "neutral"
                        }
                      >
                        {t(`outcomeResults.${each.resolution.outcome}`)}
                      </Chip>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}
