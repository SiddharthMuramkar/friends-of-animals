import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { FormAlert } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import {
  adminBatchRefundPath,
  adminPaymentBatchPath,
  adminRefundPath,
  APP_ROUTES,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { RefundableBatch } from "@/server/modules/payments";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { REFUND_TEXT_MAX_LENGTH } from "@/server/modules/payments/refunds/rows";

import { adminCall } from "../../../../_lib/boundary";
import { RequestForm } from "../../../../refunds/_components/request-form";
import { RefundsDenied } from "../../../../refunds/_components/refunds-denied";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminRefunds.request.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

const ROW = "grid gap-1 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4";

type Props = PageProps<"/admin/payments/batches/[id]/refund">;

/**
 * Asking for a refund of a paid batch (#80): every student left, or the
 * ones ticked, with a reason. A competition manager of its competition
 * (or of all), a staff admin or a super admin; finance decides it on the
 * refunds page.
 */
export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminRefunds");
  const { id } = await params;
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <ButtonLink
        href={adminPaymentBatchPath(id)}
        variant="quiet"
        className="-ms-5 mb-4"
      >
        {t("request.back")}
      </ButtonLink>
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Request batchId={id} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Request({
  batchId,
  searchParams,
}: {
  batchId: string;
  searchParams: Props["searchParams"];
}) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const call = await adminCall(
    () => as(actor).getRefundableBatch({ batchId }),
    adminBatchRefundPath(batchId)
  );
  if (!call.ok) return <RefundsDenied headingLevel="h1" />;
  const t = await getTranslations("adminRefunds");
  if (!call.value.ok) {
    return (
      <ExplainState
        title={t("request.notFound.title")}
        headingLevel="h1"
        back={{ href: APP_ROUTES.dashboard, label: t("request.notFound.back") }}
      >
        <p>{t("request.notFound.body")}</p>
      </ExplainState>
    );
  }
  const { batch } = call.value;
  const { sent } = await searchParams;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="yellow"
        title={t("request.title")}
        lead={t("request.lead")}
      />
      {sent === "1" ? (
        <FormAlert tone="success" label={t("statuses.requested")}>
          <p>{t("request.sent")}</p>
        </FormAlert>
      ) : null}
      <Summary batch={batch} />
      <Ask batch={batch} />
      <Refunds batch={batch} />
    </div>
  );
}

async function Summary({ batch }: { batch: RefundableBatch }) {
  const t = await getTranslations("adminRefunds");
  return (
    <section aria-labelledby="request-summary" className={CARD}>
      <SectionHeading id="request-summary" title={t("request.summaryTitle")} />
      <dl className="mt-4 flex flex-col gap-3 text-ink">
        <div className={ROW}>
          <dt className="font-semibold">{t("request.summary.payer")}</dt>
          <dd className="wrap-anywhere">
            {batch.payer?.name ?? t("payer.unknown")}
          </dd>
        </div>
        <div className={ROW}>
          <dt className="font-semibold">{t("request.summary.competition")}</dt>
          <dd className="wrap-anywhere">{batch.competitionName}</dd>
        </div>
        <div className={ROW}>
          <dt className="font-semibold">{t("request.summary.amount")}</dt>
          <dd>{formatPaise(batch.amountMinor)}</dd>
        </div>
        {batch.status === "captured" ? (
          <div className={ROW}>
            <dt className="font-semibold">{t("request.summary.method")}</dt>
            <dd>
              {batch.captureMethod === "offline"
                ? t("request.summary.offline")
                : t("request.summary.gateway")}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

async function Ask({ batch }: { batch: RefundableBatch }) {
  const [t, callout] = await Promise.all([
    getTranslations("adminRefunds"),
    getTranslations("common.callout"),
  ]);
  const free = batch.items.filter((item) => item.refund === "none");
  const taken = batch.items.filter((item) => item.refund !== "none");
  const numberOf = (item: RefundableBatch["items"][number]) =>
    item.registrationNumber ?? t("detail.studentsTable.noNumber");
  const limit = { max: REFUND_TEXT_MAX_LENGTH };
  return (
    <section aria-labelledby="request-ask" className={CARD}>
      <SectionHeading id="request-ask" title={t("request.form.title")} />
      {batch.status !== "captured" ? (
        <p className="mt-3 text-ink">{t("request.notCaptured")}</p>
      ) : free.length === 0 ? (
        <p className="mt-3 text-ink">{t("request.form.noneLeft")}</p>
      ) : (
        <div className="mt-5">
          <RequestForm
            batchId={batch.id}
            students={free.map((item) => ({
              registrationId: item.registrationId,
              label: t("request.form.student", {
                number: numberOf(item),
                amount: formatPaise(item.amountMinor),
              }),
            }))}
            maxReasonLength={REFUND_TEXT_MAX_LENGTH}
            labels={{
              students: {
                legend: t("request.form.students"),
                hint: t("request.form.studentsHint"),
              },
              reason: {
                label: t("request.form.reason.label"),
                hint: t("request.form.reason.hint", limit),
              },
              errors: {
                reason_required: t("request.form.errors.reason_required"),
                reason_too_long: t(
                  "request.form.errors.reason_too_long",
                  limit
                ),
              },
              alerts: {
                batch_not_captured: t("request.form.alerts.batch_not_captured"),
                nothing_to_refund: t("request.form.alerts.nothing_to_refund"),
                item_in_live_refund: t(
                  "request.form.alerts.item_in_live_refund"
                ),
                item_already_refunded: t(
                  "request.form.alerts.item_already_refunded"
                ),
                exceeds_paid: t("request.form.alerts.exceeds_paid"),
                unexpected: t("request.form.alerts.unexpected"),
              },
              submit: t("request.form.submit"),
              saving: t("request.form.saving"),
              problem: callout("danger"),
            }}
          />
        </div>
      )}
      {taken.length > 0 ? (
        <ul className="mt-5 flex flex-col gap-1 text-ink-muted">
          {taken.map((item) => (
            <li key={item.registrationId} className="font-mono">
              {item.refund === "refunded"
                ? t("request.form.refunded", { number: numberOf(item) })
                : t("request.form.inRefund", { number: numberOf(item) })}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

async function Refunds({ batch }: { batch: RefundableBatch }) {
  const t = await getTranslations("adminRefunds");
  return (
    <section aria-labelledby="request-refunds" className={CARD}>
      <SectionHeading id="request-refunds" title={t("request.refundsTitle")} />
      {batch.refunds.length === 0 ? (
        <p className="mt-3 text-ink-muted">{t("request.refundsNone")}</p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {batch.refunds.map((each) => (
            <li key={each.id}>
              <SiteLink href={adminRefundPath(each.id)} className={LINK}>
                {t("request.refundItem", {
                  amount: formatPaise(each.amountMinor),
                  status: t(`statuses.${each.status}`),
                })}
              </SiteLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
