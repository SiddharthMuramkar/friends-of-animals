import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { FormAlert } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import {
  ADMIN_REFUNDS,
  adminPaymentBatchPath,
  adminRefundPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { RefundView } from "@/server/modules/payments";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { REFUND_TEXT_MAX_LENGTH } from "@/server/modules/payments/refunds/rows";

import { adminCall } from "../../_lib/boundary";
import {
  DecisionForm,
  type DecisionFormLabels,
  type RefundDecision,
} from "../_components/decision-form";
import { ManualForm } from "../_components/manual-form";
import { RefundsDenied } from "../_components/refunds-denied";
import { statusTone } from "../_lib/status-tone";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminRefunds.detail.meta");
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

const DONE = ["approved", "rejected", "retried", "recorded"] as const;

type Props = PageProps<"/admin/refunds/[id]">;

/**
 * One refund (#80): what it returns and why, who asked and who decided,
 * and what finance may do now: approve or reject a request, retry or
 * close a failed refund, or record paying back by hand.
 */
export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminRefunds");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <ButtonLink href={ADMIN_REFUNDS} variant="quiet" className="-ms-5 mb-4">
        {t("detail.back")}
      </ButtonLink>
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Refund params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Refund({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id } = await params;
  const call = await adminCall(
    () => as(actor).getRefund({ refundId: id }),
    adminRefundPath(id)
  );
  if (!call.ok) return <RefundsDenied headingLevel="h1" />;
  const t = await getTranslations("adminRefunds");
  if (!call.value.ok) {
    return (
      <ExplainState
        title={t("detail.notFound.title")}
        headingLevel="h1"
        back={{ href: ADMIN_REFUNDS, label: t("detail.notFound.back") }}
      >
        <p>{t("detail.notFound.body")}</p>
      </ExplainState>
    );
  }
  const { refund } = call.value;
  const { done } = await searchParams;
  const outcome = DONE.find((each) => each === done);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="yellow"
        title={t("detail.title", { amount: formatPaise(refund.amountMinor) })}
        lead={t(`kinds.${refund.kind}`)}
      />
      {outcome ? (
        <FormAlert tone="success" label={t(`statuses.${refund.status}`)}>
          <p>{t(`detail.done.${outcome}`)}</p>
        </FormAlert>
      ) : null}
      <Details refund={refund} />
      <Students refund={refund} />
      <Actions refund={refund} />
    </div>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className={ROW}>
      <dt className="font-semibold">{term}</dt>
      <dd className="wrap-anywhere">{children}</dd>
    </div>
  );
}

async function Details({ refund }: { refund: RefundView }) {
  const [t, format] = await Promise.all([
    getTranslations("adminRefunds"),
    getFormatter(),
  ]);
  const when = (at: Date) => (
    <time dateTime={at.toISOString()}>
      {format.dateTime(at, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
  return (
    <section aria-labelledby="refund-details" className={CARD}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SectionHeading id="refund-details" title={t("detail.detailsTitle")} />
        <Chip tone={statusTone(refund.status)}>
          {t(`statuses.${refund.status}`)}
        </Chip>
      </div>
      <dl className="mt-4 flex flex-col gap-3 text-ink">
        <Row term={t("detail.details.payer")}>
          {refund.payer?.name ?? t("payer.unknown")}
        </Row>
        <Row term={t("detail.details.competition")}>
          {refund.competitionName}
        </Row>
        {refund.reference ? (
          <Row term={t("detail.details.reference")}>{refund.reference}</Row>
        ) : null}
        <Row term={t("detail.details.amount")}>
          {formatPaise(refund.amountMinor)}
        </Row>
        <Row term={t("detail.details.paid")}>
          {formatPaise(refund.batchAmountMinor)}
        </Row>
        <Row term={t("detail.details.method")}>
          {t(`methods.${refund.method}`)}
        </Row>
        <Row term={t("detail.details.requestedBy")}>
          {refund.kind === "discretionary"
            ? (refund.requestedByName ?? t("payer.unknown"))
            : t("detail.details.system")}
        </Row>
        <Row term={t("detail.details.requestedOn")}>
          {when(refund.requestedAt)}
        </Row>
        <Row term={t("detail.details.reason")}>
          <span className="whitespace-pre-line">{refund.reason}</span>
        </Row>
        {refund.decidedAt && refund.kind === "discretionary" ? (
          <>
            <Row term={t("detail.details.decidedBy")}>
              {refund.decidedByName ?? t("payer.noName")}
            </Row>
            <Row term={t("detail.details.decidedOn")}>
              {when(refund.decidedAt)}
            </Row>
          </>
        ) : null}
        {refund.decisionNote ? (
          <Row term={t("detail.details.note")}>
            <span className="whitespace-pre-line">{refund.decisionNote}</span>
          </Row>
        ) : null}
        {refund.gatewayPaymentId ? (
          <Row term={t("detail.details.gatewayPayment")}>
            <span className="font-mono">{refund.gatewayPaymentId}</span>
          </Row>
        ) : null}
        {refund.gatewayRefundId ? (
          <Row term={t("detail.details.gatewayRefund")}>
            <span className="font-mono">{refund.gatewayRefundId}</span>
          </Row>
        ) : null}
        {refund.attempt > 1 ? (
          <Row term={t("detail.details.attempt")}>{refund.attempt}</Row>
        ) : null}
        {refund.manualMethod && refund.manualReference ? (
          <Row term={t("detail.details.manual")}>
            {t("detail.details.manualValue", {
              method: t(`manualMethods.${refund.manualMethod}`),
              reference: refund.manualReference,
            })}
          </Row>
        ) : null}
        {refund.refundedAt ? (
          <Row term={t("detail.details.refundedOn")}>
            {when(refund.refundedAt)}
          </Row>
        ) : null}
        {refund.failedAt && refund.status === "failed" ? (
          <Row term={t("detail.details.failedOn")}>{when(refund.failedAt)}</Row>
        ) : null}
      </dl>
      <p className="mt-4">
        <SiteLink href={adminPaymentBatchPath(refund.batchId)} className={LINK}>
          {t("detail.details.batchLink")}
        </SiteLink>
      </p>
    </section>
  );
}

async function Students({ refund }: { refund: RefundView }) {
  const t = await getTranslations("adminRefunds");
  const head = "px-4 py-3 whitespace-nowrap";
  const cell = "px-4 py-3 align-top";
  return (
    <section aria-labelledby="refund-students" className={CARD}>
      <SectionHeading id="refund-students" title={t("detail.studentsTitle")} />
      {refund.items.length === 0 ? (
        <p className="mt-3 text-ink">{t("detail.studentsNone")}</p>
      ) : (
        <div className="mt-4">
          <TableScroller captionId="refund-students-caption">
            <table className="w-full text-left">
              <caption id="refund-students-caption" className="sr-only">
                {t("detail.studentsTable.caption")}
              </caption>
              <thead className="bg-surface-muted text-sm">
                <tr>
                  <th scope="col" className={head}>
                    {t("detail.studentsTable.number")}
                  </th>
                  <th scope="col" className={head}>
                    {t("detail.studentsTable.status")}
                  </th>
                  <th scope="col" className={head}>
                    {t("detail.studentsTable.amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {refund.items.map((item) => (
                  <tr
                    key={item.registrationId}
                    className="border-t border-border"
                  >
                    <th scope="row" className={`${cell} font-mono font-normal`}>
                      {item.registrationNumber ??
                        t("detail.studentsTable.noNumber")}
                    </th>
                    <td className={cell}>
                      {item.released
                        ? t("detail.studentsTable.released")
                        : t(`registrationStatus.${item.status}`)}
                    </td>
                    <td className={`${cell} whitespace-nowrap`}>
                      {formatPaise(item.amountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </div>
      )}
    </section>
  );
}

async function Actions({ refund }: { refund: RefundView }) {
  const [t, callout] = await Promise.all([
    getTranslations("adminRefunds"),
    getTranslations("common.callout"),
  ]);
  const decidable =
    refund.status === "requested" ||
    refund.status === "failed" ||
    (refund.status === "approved" && refund.method === "manual");
  if (!decidable) return null;
  const limit = { max: REFUND_TEXT_MAX_LENGTH };
  const labels = (
    decisions: DecisionFormLabels["decisions"]
  ): DecisionFormLabels => ({
    note: {
      label: t("detail.decision.note.label"),
      hint: t("detail.decision.note.hint", limit),
    },
    errors: {
      note_required: t("detail.decision.errors.note_required"),
      note_too_long: t("detail.decision.errors.note_too_long", limit),
    },
    alerts: {
      not_requested: t("detail.decision.alerts.not_requested"),
      not_rejectable: t("detail.decision.alerts.not_rejectable"),
      not_failed: t("detail.failed.alerts.not_failed"),
      same_person: t("detail.decision.alerts.same_person"),
      unexpected: t("detail.decision.alerts.unexpected"),
    },
    decisions,
    saving: t("detail.decision.saving"),
    problem: callout("danger"),
  });

  if (refund.status === "requested") {
    const offered: RefundDecision[] = ["approve", "reject"];
    return (
      <section aria-labelledby="refund-decision" className={CARD}>
        <SectionHeading
          id="refund-decision"
          title={t("detail.decisionTitle")}
        />
        <h3 className="mt-4 font-semibold text-ink">
          {t("detail.policyTitle")}
        </h3>
        <p className="mt-1 text-ink">{t("detail.policy")}</p>
        {!refund.viewer.mayDecide ? (
          <p className="mt-4 text-ink-muted">
            {t("detail.decision.financeOnly")}
          </p>
        ) : refund.viewer.isRequester ? (
          <p className="mt-4 text-ink-muted">
            {t("detail.decision.ownRequest")}
          </p>
        ) : (
          <>
            <p className="mt-4 text-ink">{t("detail.decision.lead")}</p>
            <div className="mt-5">
              <DecisionForm
                refundId={refund.id}
                decisions={offered}
                maxNoteLength={REFUND_TEXT_MAX_LENGTH}
                labels={labels({
                  approve: t("detail.decision.approve"),
                  reject: t("detail.decision.reject"),
                })}
              />
            </div>
          </>
        )}
      </section>
    );
  }

  if (!refund.viewer.mayDecide) return null;

  if (refund.status === "failed") {
    return (
      <section aria-labelledby="refund-failed" className={CARD}>
        <SectionHeading id="refund-failed" title={t("detail.failedTitle")} />
        <p className="mt-3 text-ink">{t("detail.failed.lead")}</p>
        <div className="mt-5">
          <DecisionForm
            refundId={refund.id}
            decisions={["retry", "reject"]}
            maxNoteLength={REFUND_TEXT_MAX_LENGTH}
            labels={labels({
              retry: t("detail.failed.retry"),
              reject: t("detail.failed.close"),
            })}
          />
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="refund-manual" className={CARD}>
      <SectionHeading id="refund-manual" title={t("detail.manualTitle")} />
      <p className="mt-3 text-ink">{t("detail.manual.lead")}</p>
      <div className="mt-5">
        <ManualForm
          refundId={refund.id}
          labels={{
            method: {
              legend: t("detail.manual.method"),
              options: {
                bank_transfer: t("manualMethods.bank_transfer"),
                cheque: t("manualMethods.cheque"),
                cash: t("manualMethods.cash"),
              },
            },
            reference: {
              label: t("detail.manual.reference.label"),
              hint: t("detail.manual.reference.hint"),
            },
            errors: {
              reference_invalid: t("detail.manual.errors.reference_invalid"),
            },
            alerts: {
              not_approved: t("detail.manual.alerts.not_approved"),
              not_manual: t("detail.manual.alerts.not_manual"),
              unexpected: t("unexpected"),
            },
            submit: t("detail.manual.submit"),
            saving: t("detail.decision.saving"),
            problem: callout("danger"),
          }}
        />
      </div>
    </section>
  );
}
