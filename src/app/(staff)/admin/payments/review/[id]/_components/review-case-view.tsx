import { getFormatter, getTranslations } from "next-intl/server";

import { FormAlert } from "@/components/form";
import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { SiteLink } from "@/components/site/site-link";
import { adminPaymentBatchPath } from "@/lib/app-routes";
import type { PaymentReviewCaseView } from "@/server/modules/payments";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import {
  RESOLUTION_REASON_MAX_LENGTH,
  RESOLUTION_REASON_MIN_LENGTH,
  type PaymentReviewOutcome,
} from "@/server/modules/payments/domain/review-case";

import {
  ResolveForm,
  type ResolveFormLabels,
} from "../../../_components/resolve-form";

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

export async function ReviewCaseView({
  reviewCase,
  outcome,
}: {
  reviewCase: PaymentReviewCaseView;
  outcome?: PaymentReviewOutcome | undefined;
}) {
  const t = await getTranslations("adminPayments");
  const amount = formatPaise(reviewCase.amountMinor);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="yellow"
        title={t("case.title", { amount })}
        lead={t(
          reviewCase.participationUnavailable
            ? "reasonBodies.participation_unavailable"
            : `reasonBodies.${reviewCase.reason}`
        )}
      />
      {outcome && reviewCase.resolution ? (
        <FormAlert tone="success" label={t("case.resolvedTitle")}>
          <p>{t(`case.done.${outcome}`)}</p>
        </FormAlert>
      ) : null}
      <Details reviewCase={reviewCase} />
      {reviewCase.resolution ? (
        <Resolved reviewCase={reviewCase} />
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
        <Chip tone="marigold">
          {t(
            reviewCase.participationUnavailable &&
              reviewCase.reason === "participation_consent_required"
              ? "reasons.participation_unavailable"
              : `reasons.${reviewCase.reason}`
          )}
        </Chip>
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
            {formatPaise(reviewCase.amountMinor)}
            {reviewCase.currency === "INR" ? "" : ` (${reviewCase.currency})`}
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
  const confirmationNote = !reviewCase.allowedOutcomes.includes("confirm")
    ? "case.decision.noConfirm"
    : reviewCase.otherOpenCases > 0
      ? "case.decision.othersFirst"
      : null;
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
      <p className="mt-3 text-ink">
        {t(
          reviewCase.participationUnavailable
            ? "case.decision.unavailableLead"
            : "case.decision.lead"
        )}
      </p>
      {!reviewCase.participationUnavailable && confirmationNote ? (
        <p className="mt-3 text-ink-muted">{t(confirmationNote)}</p>
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

async function Resolved({ reviewCase }: { reviewCase: PaymentReviewCaseView }) {
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
          <dd>{t(`outcomeResults.${resolution.outcome}`)}</dd>
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
      {resolution.refundDue ? (
        <p className="mt-4 font-semibold text-ink">
          {t("case.resolved.refundDue")}
        </p>
      ) : null}
    </section>
  );
}
