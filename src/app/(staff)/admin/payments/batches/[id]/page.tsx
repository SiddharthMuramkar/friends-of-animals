import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { FormAlert, SubmitButton } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import {
  ADMIN_PAYMENTS_REVIEW,
  adminBatchRefundPath,
  adminPaymentBatchPath,
  adminPaymentReviewCasePath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type {
  PaymentBatchStatus,
  StaffPaymentBatch,
} from "@/server/modules/payments";
import { formatPaiseForInput } from "@/server/modules/competitions/domain/fees";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { istDate } from "@/server/modules/payments/domain/offline-payment";

import { adminCall } from "../../../_lib/boundary";
import {
  OfflinePaymentForm,
  type OfflinePaymentFormLabels,
} from "../../_components/offline-payment-form";
import { PaymentsDenied } from "../../_components/payments-denied";
import { openProofAction } from "../../_lib/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminPayments.batch.meta");
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

const BATCH_TONE = {
  created: "neutral",
  order_created: "marigold",
  captured: "green",
  failed: "neutral",
  cancelled: "neutral",
  needs_review: "marigold",
} as const satisfies Record<PaymentBatchStatus, string>;

const PROOF_ERRORS = [
  "not_found",
  "file_not_ready",
  "file_unavailable",
] as const;

type Props = PageProps<"/admin/payments/batches/[id]">;

/**
 * One payment batch as finance sees it (#79): what it is for, how it was
 * paid, its registrations, any payments in review, and, while nobody has
 * paid it, the form to record a cheque, bank transfer or cash against it.
 */
export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminPayments");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <ButtonLink
        href={ADMIN_PAYMENTS_REVIEW}
        variant="quiet"
        className="-ms-5 mb-4"
      >
        {t("batch.back")}
      </ButtonLink>
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Batch params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Batch({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id } = await params;
  const call = await adminCall(
    () => as(actor).getPaymentBatchForStaff({ batchId: id }),
    adminPaymentBatchPath(id)
  );
  if (!call.ok) return <PaymentsDenied headingLevel="h1" />;
  const t = await getTranslations("adminPayments");
  if (!call.value.ok) {
    return (
      <ExplainState
        title={t("batch.notFound.title")}
        headingLevel="h1"
        back={{
          href: ADMIN_PAYMENTS_REVIEW,
          label: t("batch.notFound.back"),
        }}
      >
        <p>{t("batch.notFound.body")}</p>
      </ExplainState>
    );
  }
  const { batch } = call.value;
  const query = await searchParams;
  const proofError = PROOF_ERRORS.find((each) => each === query.proof);
  const callout = await getTranslations("common.callout");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="yellow"
        title={t("batch.title", { amount: formatPaise(batch.amountMinor) })}
      />
      {query.recorded === "1" && batch.captureMethod === "offline" ? (
        <FormAlert tone="success" label={callout("success")}>
          <p>{t("batch.recorded")}</p>
        </FormAlert>
      ) : null}
      {proofError ? (
        <FormAlert tone="danger" label={callout("danger")}>
          <p>{t(`batch.proofErrors.${proofError}`)}</p>
        </FormAlert>
      ) : null}
      <Details batch={batch} />
      {batch.status === "captured" ? (
        // Refunds (#80): asking for one, and its progress, on its own page.
        <p>
          <SiteLink href={adminBatchRefundPath(batch.id)} className={LINK}>
            {t("batch.refundLink")}
          </SiteLink>
        </p>
      ) : null}
      {batch.offlinePayment ? <OfflinePayment batch={batch} /> : null}
      {batch.reviewCases.length > 0 ? <ReviewCases batch={batch} /> : null}
      <Students batch={batch} />
      {batch.canRecordOffline ? <RecordOffline batch={batch} /> : null}
    </div>
  );
}

async function Details({ batch }: { batch: StaffPaymentBatch }) {
  const [t, format] = await Promise.all([
    getTranslations("adminPayments"),
    getFormatter(),
  ]);
  const when = (at: Date) => (
    <time dateTime={at.toISOString()}>
      {format.dateTime(at, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
  return (
    <section aria-labelledby="batch-details" className={CARD}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SectionHeading id="batch-details" title={t("batch.detailsTitle")} />
        <Chip tone={BATCH_TONE[batch.status]}>
          {t(`batchStatus.${batch.status}`)}
        </Chip>
      </div>
      <dl className="mt-4 flex flex-col gap-3 text-ink">
        <div className={ROW}>
          <dt className="font-semibold">{t("batch.details.payer")}</dt>
          <dd className="wrap-anywhere">
            {batch.payer?.name ?? t("payer.unknown")}
          </dd>
        </div>
        <div className={ROW}>
          <dt className="font-semibold">{t("batch.details.competition")}</dt>
          <dd className="wrap-anywhere">{batch.competitionName}</dd>
        </div>
        {batch.reference ? (
          <div className={ROW}>
            <dt className="font-semibold">{t("batch.details.reference")}</dt>
            <dd className="font-mono wrap-anywhere">{batch.reference}</dd>
          </div>
        ) : null}
        <div className={ROW}>
          <dt className="font-semibold">{t("batch.details.amount")}</dt>
          <dd>{formatPaise(batch.amountMinor)}</dd>
        </div>
        <div className={ROW}>
          <dt className="font-semibold">{t("batch.details.started")}</dt>
          <dd>{when(batch.createdAt)}</dd>
        </div>
        {batch.capturedAt ? (
          <div className={ROW}>
            <dt className="font-semibold">{t("batch.details.paidOn")}</dt>
            <dd>{when(batch.capturedAt)}</dd>
          </div>
        ) : null}
        {batch.captureMethod ? (
          <div className={ROW}>
            <dt className="font-semibold">{t("batch.details.paidHow")}</dt>
            <dd>
              {batch.captureMethod === "offline"
                ? t("batch.details.offline")
                : t("batch.details.gateway")}
            </dd>
          </div>
        ) : null}
        {batch.gatewayPaymentId ? (
          <div className={ROW}>
            <dt className="font-semibold">
              {t("batch.details.gatewayPayment")}
            </dt>
            <dd className="font-mono wrap-anywhere">
              {batch.gatewayPaymentId}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

async function OfflinePayment({ batch }: { batch: StaffPaymentBatch }) {
  const [t, format] = await Promise.all([
    getTranslations("adminPayments"),
    getFormatter(),
  ]);
  const paid = batch.offlinePayment;
  if (!paid) return null;
  const proofReady = paid.proofStatus === "clean";
  const proofWaiting =
    paid.proofStatus === "uploaded" || paid.proofStatus === "scanning";
  return (
    <section aria-labelledby="batch-offline" className={CARD}>
      <SectionHeading id="batch-offline" title={t("batch.offlineTitle")} />
      <dl className="mt-4 flex flex-col gap-3 text-ink">
        <div className={ROW}>
          <dt className="font-semibold">{t("batch.offline.method")}</dt>
          <dd>{t(`methods.${paid.method}`)}</dd>
        </div>
        <div className={ROW}>
          <dt className="font-semibold">{t("batch.offline.reference")}</dt>
          <dd className="font-mono wrap-anywhere">{paid.reference}</dd>
        </div>
        <div className={ROW}>
          <dt className="font-semibold">{t("batch.offline.amount")}</dt>
          <dd>{formatPaise(paid.amountMinor)}</dd>
        </div>
        <div className={ROW}>
          <dt className="font-semibold">{t("batch.offline.receivedOn")}</dt>
          <dd>
            <time dateTime={paid.receivedOn}>
              {format.dateTime(new Date(`${paid.receivedOn}T00:00:00Z`), {
                dateStyle: "medium",
                timeZone: "UTC",
              })}
            </time>
          </dd>
        </div>
        <div className={ROW}>
          <dt className="font-semibold">{t("batch.offline.recordedBy")}</dt>
          <dd className="wrap-anywhere">
            {paid.recordedByName ?? t("batch.offline.nobody")}
          </dd>
        </div>
        <div className={ROW}>
          <dt className="font-semibold">{t("batch.offline.recordedAt")}</dt>
          <dd>
            <time dateTime={paid.recordedAt.toISOString()}>
              {format.dateTime(paid.recordedAt, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </dd>
        </div>
        <div className={ROW}>
          <dt className="font-semibold">{t("batch.offline.proof")}</dt>
          <dd>{t(`batch.offline.proofStatus.${paid.proofStatus}`)}</dd>
        </div>
      </dl>
      {proofReady ? (
        <form action={openProofAction} className="mt-5">
          <input type="hidden" name="batchId" value={batch.id} />
          <SubmitButton variant="secondary" pendingLabel={t("loading")}>
            {t("batch.offline.openProof")}
          </SubmitButton>
        </form>
      ) : (
        <p className="mt-4 text-ink-muted">
          {proofWaiting
            ? t("batch.offline.proofWaiting")
            : t("batch.offline.proofUnavailable")}
        </p>
      )}
    </section>
  );
}

async function ReviewCases({ batch }: { batch: StaffPaymentBatch }) {
  const t = await getTranslations("adminPayments");
  return (
    <section aria-labelledby="batch-cases" className={CARD}>
      <SectionHeading id="batch-cases" title={t("batch.casesTitle")} />
      <ul className="mt-3 flex flex-col">
        {batch.reviewCases.map((each) => (
          <li key={each.id}>
            <SiteLink
              href={adminPaymentReviewCasePath(each.id)}
              className={LINK}
            >
              {t("batch.cases.item", {
                reason: t(`reasons.${each.reason}`),
                state: each.outcome
                  ? t(`outcomeResults.${each.outcome}`)
                  : t("batch.cases.open"),
              })}
            </SiteLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Students({ batch }: { batch: StaffPaymentBatch }) {
  const t = await getTranslations("adminPayments");
  return (
    <TableScroller captionId="batch-students">
      <table className="w-full text-left">
        <caption
          id="batch-students"
          className="px-5 pt-4 text-left text-h3 font-semibold"
        >
          {t("batch.students.caption")}
        </caption>
        <thead className="bg-surface-muted text-sm">
          <tr>
            <th scope="col" className="px-5 py-3">
              {t("batch.students.student")}
            </th>
            <th scope="col" className="px-5 py-3">
              {t("batch.students.status")}
            </th>
            <th scope="col" className="px-5 py-3">
              {t("batch.students.number")}
            </th>
          </tr>
        </thead>
        <tbody>
          {batch.students.map((student, index) => (
            <tr
              key={student.registrationId}
              className="border-t border-border align-top"
            >
              <th scope="row" className="px-5 py-4 font-semibold">
                {t("batch.students.row", { n: index + 1 })}
              </th>
              <td className="px-5 py-4">
                {t(`registrationStatus.${student.status}`)}
                {student.held ? null : (
                  <span className="block text-sm text-ink-muted">
                    {t("batch.students.released")}
                  </span>
                )}
              </td>
              <td className="px-5 py-4 font-mono">
                {student.registrationNumber ?? (
                  <span className="font-sans text-ink-muted">
                    {t("batch.students.noNumber")}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

async function RecordOffline({ batch }: { batch: StaffPaymentBatch }) {
  const [t, methods, callout] = await Promise.all([
    getTranslations("adminPayments.batch.record"),
    getTranslations("adminPayments.methods"),
    getTranslations("common.callout"),
  ]);
  const amount = formatPaise(batch.amountMinor);
  const labels: OfflinePaymentFormLabels = {
    method: {
      legend: t("method.legend"),
      options: {
        cheque: methods("cheque"),
        bank_transfer: methods("bank_transfer"),
        cash: methods("cash"),
      },
    },
    reference: { label: t("reference.label"), hint: t("reference.hint") },
    amount: { label: t("amount.label"), hint: t("amount.hint", { amount }) },
    receivedOn: { label: t("receivedOn.label"), hint: t("receivedOn.hint") },
    proof: { label: t("proof.label"), hint: t("proof.hint") },
    submit: t("submit"),
    saving: t("saving"),
    errors: {
      reference_invalid: t("errors.reference_invalid"),
      amount_invalid: t("errors.amount_invalid"),
      amount_mismatch: t("errors.amount_mismatch"),
      received_on_invalid: t("errors.received_on_invalid"),
      received_in_future: t("errors.received_in_future"),
      received_too_long_ago: t("errors.received_too_long_ago"),
    },
    alerts: {
      proof_invalid: t("alerts.proof_invalid"),
      already_paid: t("alerts.already_paid"),
      batch_not_payable: t("alerts.batch_not_payable"),
      registration_not_payable: t("alerts.registration_not_payable"),
      type_not_allowed: t("alerts.type_not_allowed"),
      too_large: t("alerts.too_large"),
      empty: t("alerts.empty"),
      upload_failed: t("alerts.upload_failed"),
      unexpected: t("alerts.unexpected"),
    },
    problem: callout("danger"),
  };
  return (
    <section aria-labelledby="batch-record" className={CARD}>
      <SectionHeading id="batch-record" title={t("title")} lead={t("lead")} />
      <div className="mt-5">
        <OfflinePaymentForm
          batchId={batch.id}
          defaults={{
            amount: formatPaiseForInput(batch.amountMinor),
            // The page renders per request: today in India, as a default.
            receivedOn: istDate(new Date()),
          }}
          labels={labels}
        />
      </div>
    </section>
  );
}
