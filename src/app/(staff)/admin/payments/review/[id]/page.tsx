import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import {
  ADMIN_PAYMENTS_REVIEW,
  adminPaymentBatchPath,
  adminPaymentReviewCasePath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { PaymentReviewCaseView } from "@/server/modules/payments";
import {
  formatCapturedAmount,
  formatPaise,
} from "@/server/modules/payments/domain/money-format";
import {
  PAYMENT_REVIEW_OUTCOMES,
  RESOLUTION_REASON_MAX_LENGTH,
  RESOLUTION_REASON_MIN_LENGTH,
  type PaymentReviewOutcome,
} from "@/server/modules/payments/domain/review-case";

import { adminCall } from "../../../_lib/boundary";
import { PaymentsDenied } from "../../_components/payments-denied";
import {
  ResolveForm,
  type ResolveFormLabels,
} from "../../_components/resolve-form";
import { recordDashboardRefundAction } from "../../_lib/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminPayments.case.meta");
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

type Props = PageProps<"/admin/payments/review/[id]">;

/**
 * One payment needing review (#79): what arrived, why it couldn't be
 * accepted, and the decision staff take on it with a reason. Finance,
 * staff admins and super admins.
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
        {t("case.back")}
      </ButtonLink>
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <ReviewCase params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function ReviewCase({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id } = await params;
  const call = await adminCall(
    () => as(actor).getPaymentReviewCase({ caseId: id }),
    adminPaymentReviewCasePath(id)
  );
  if (!call.ok) return <PaymentsDenied headingLevel="h1" />;
  const t = await getTranslations("adminPayments");
  if (!call.value.ok) {
    return (
      <ExplainState
        title={t("case.notFound.title")}
        headingLevel="h1"
        back={{
          href: ADMIN_PAYMENTS_REVIEW,
          label: t("case.notFound.back"),
        }}
      >
        <p>{t("case.notFound.body")}</p>
      </ExplainState>
    );
  }
  const { reviewCase } = call.value;
  const { done, record } = await searchParams;
  const outcome =
    typeof done === "string" &&
    (PAYMENT_REVIEW_OUTCOMES as readonly string[]).includes(done)
      ? (done as PaymentReviewOutcome)
      : undefined;
  const amount = formatCapturedAmount(
    reviewCase.amountMinor,
    reviewCase.currency
  );
  const manualRefund = reviewCase.resolution?.manualRefund;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="yellow"
        title={t("case.title", { amount })}
        lead={t(`reasonBodies.${reviewCase.reason}`)}
      />
      {outcome && outcome === reviewCase.resolution?.outcome ? (
        <FormAlert tone="success" label={t("case.resolvedTitle")}>
          <p>
            {manualRefund
              ? t(`manualRefund.${manualRefund}`)
              : t(`case.done.${outcome}`)}
          </p>
        </FormAlert>
      ) : null}
      <Details reviewCase={reviewCase} />
      {reviewCase.resolution ? (
        <Resolved
          reviewCase={reviewCase}
          recordError={
            record === "invalid_reference" ||
            record === "unexpected" ||
            record === "refund_unverified" ||
            record === "reference_already_recorded"
              ? record
              : undefined
          }
        />
      ) : (
        <Decision reviewCase={reviewCase} />
      )}
    </div>
  );
}

async function Details({ reviewCase }: { reviewCase: PaymentReviewCaseView }) {
  const [t, format] = await Promise.all([
    getTranslations("adminPayments"),
    getFormatter(),
  ]);
  const row = "grid gap-1 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4";
  return (
    <section aria-labelledby="case-details" className={CARD}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SectionHeading id="case-details" title={t("case.detailsTitle")} />
        <Chip tone="marigold">{t(`reasons.${reviewCase.reason}`)}</Chip>
      </div>
      <dl className="mt-4 flex flex-col gap-3 text-ink">
        <div className={row}>
          <dt className="font-semibold">{t("case.details.payer")}</dt>
          <dd className="wrap-anywhere">
            {reviewCase.payer?.name ?? t("payer.unknown")}
          </dd>
        </div>
        <div className={row}>
          <dt className="font-semibold">{t("case.details.competition")}</dt>
          <dd className="wrap-anywhere">{reviewCase.competitionName}</dd>
        </div>
        <div className={row}>
          <dt className="font-semibold">{t("case.details.received")}</dt>
          <dd>
            {formatCapturedAmount(reviewCase.amountMinor, reviewCase.currency)}
          </dd>
        </div>
        <div className={row}>
          <dt className="font-semibold">{t("case.details.expected")}</dt>
          <dd>{formatPaise(reviewCase.batchAmountMinor)}</dd>
        </div>
        {reviewCase.gatewayPaymentId ? (
          <div className={row}>
            <dt className="font-semibold">
              {t("case.details.gatewayPayment")}
            </dt>
            <dd className="font-mono wrap-anywhere">
              {reviewCase.gatewayPaymentId}
            </dd>
          </div>
        ) : null}
        <div className={row}>
          <dt className="font-semibold">{t("case.details.arrived")}</dt>
          <dd>
            <time dateTime={reviewCase.openedAt.toISOString()}>
              {format.dateTime(reviewCase.openedAt, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </dd>
        </div>
        <div className={row}>
          <dt className="font-semibold">{t("case.details.batchStatus")}</dt>
          <dd>{t(`batchStatus.${reviewCase.batchStatus}`)}</dd>
        </div>
        {reviewCase.otherOpenCases > 0 ? (
          <div className={row}>
            <dt className="font-semibold">{t("case.details.others")}</dt>
            <dd>{reviewCase.otherOpenCases}</dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-4">
        <SiteLink
          href={adminPaymentBatchPath(reviewCase.batchId)}
          className={LINK}
        >
          {t("case.details.batchLink")}
        </SiteLink>
      </p>
    </section>
  );
}

async function Decision({ reviewCase }: { reviewCase: PaymentReviewCaseView }) {
  const [t, callout] = await Promise.all([
    getTranslations("adminPayments"),
    getTranslations("common.callout"),
  ]);
  const outcomes =
    reviewCase.otherOpenCases > 0
      ? reviewCase.allowedOutcomes.filter((each) => each !== "confirm")
      : reviewCase.allowedOutcomes;
  const limits = {
    min: RESOLUTION_REASON_MIN_LENGTH,
    max: RESOLUTION_REASON_MAX_LENGTH,
  };
  const labels: ResolveFormLabels = {
    reason: {
      label: t("case.decision.reason.label"),
      hint: t("case.decision.reason.hint", limits),
    },
    errors: {
      reason_required: t("case.decision.reason.required", limits),
      reason_too_long: t("case.decision.reason.tooLong", limits),
    },
    alerts: {
      outcome_not_allowed: t("case.decision.alerts.outcome_not_allowed"),
      resolve_other_cases_first: t(
        "case.decision.alerts.resolve_other_cases_first"
      ),
      registration_not_payable: t(
        "case.decision.alerts.registration_not_payable"
      ),
      already_resolved: t("case.decision.alerts.already_resolved"),
      unexpected: t("case.decision.alerts.unexpected"),
    },
    outcomes: {
      confirm: t("outcomes.confirm"),
      refund: t("outcomes.refund"),
      keep: t("outcomes.keep"),
    },
    saving: t("case.decision.saving"),
    problem: callout("danger"),
  };
  return (
    <section aria-labelledby="case-decision" className={CARD}>
      <SectionHeading id="case-decision" title={t("case.decisionTitle")} />
      <p className="mt-3 text-ink">{t("case.decision.lead")}</p>
      {!reviewCase.allowedOutcomes.includes("confirm") ? (
        <p className="mt-3 text-ink-muted">{t("case.decision.noConfirm")}</p>
      ) : reviewCase.otherOpenCases > 0 ? (
        <p className="mt-3 text-ink-muted">{t("case.decision.othersFirst")}</p>
      ) : null}
      <div className="mt-5">
        <ResolveForm
          caseId={reviewCase.id}
          outcomes={outcomes}
          maxReasonLength={RESOLUTION_REASON_MAX_LENGTH}
          labels={labels}
        />
      </div>
    </section>
  );
}

async function Resolved({
  reviewCase,
  recordError,
}: {
  reviewCase: PaymentReviewCaseView;
  recordError:
    | "invalid_reference"
    | "unexpected"
    | "refund_unverified"
    | "reference_already_recorded"
    | undefined;
}) {
  const [t, format] = await Promise.all([
    getTranslations("adminPayments"),
    getFormatter(),
  ]);
  const resolution = reviewCase.resolution;
  if (!resolution) return null;
  const row = "grid gap-1 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4";
  return (
    <section aria-labelledby="case-resolved" className={CARD}>
      <SectionHeading id="case-resolved" title={t("case.resolvedTitle")} />
      <dl className="mt-4 flex flex-col gap-3 text-ink">
        <div className={row}>
          <dt className="font-semibold">{t("case.resolved.outcome")}</dt>
          <dd>
            {resolution.manualRefund
              ? t(`manualRefund.${resolution.manualRefund}`)
              : t(`outcomeResults.${resolution.outcome}`)}
          </dd>
        </div>
        <div className={row}>
          <dt className="font-semibold">{t("case.resolved.by")}</dt>
          <dd className="wrap-anywhere">
            {reviewCase.resolvedByName ?? t("case.resolved.nobody")}
          </dd>
        </div>
        <div className={row}>
          <dt className="font-semibold">{t("case.resolved.on")}</dt>
          <dd>
            <time dateTime={resolution.resolvedAt.toISOString()}>
              {format.dateTime(resolution.resolvedAt, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </dd>
        </div>
        <div className={row}>
          <dt className="font-semibold">{t("case.resolved.reason")}</dt>
          <dd className="whitespace-pre-line wrap-anywhere">
            {reviewCase.resolutionReason}
          </dd>
        </div>
      </dl>
      {resolution.manualRefund === "required" ? (
        <>
          <p className="mt-4 font-semibold text-ink">
            {t("manualRefund.instructions", { currency: reviewCase.currency })}
          </p>
          <form
            className="mt-4 flex max-w-md flex-col gap-4"
            action={recordDashboardRefundAction.bind(null, reviewCase.id)}
          >
            {recordError === "unexpected" ? (
              <FormAlert tone="danger" label={t("manualRefund.errorTitle")}>
                <p>{t("manualRefund.unexpected")}</p>
              </FormAlert>
            ) : null}
            <TextField
              name="reference"
              id="dashboard-refund-reference"
              label={t("manualRefund.reference")}
              hint={t("manualRefund.hint")}
              required
              maxLength={200}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              error={
                recordError === "unexpected" || recordError === undefined
                  ? undefined
                  : t(`manualRefund.fieldErrors.${recordError}`)
              }
            />
            <div>
              <SubmitButton pendingLabel={t("manualRefund.saving")}>
                {t("manualRefund.record")}
              </SubmitButton>
            </div>
          </form>
        </>
      ) : resolution.refundDue ? (
        <p className="mt-4 font-semibold text-ink">
          {t("case.resolved.refundDue")}
        </p>
      ) : null}
    </section>
  );
}
