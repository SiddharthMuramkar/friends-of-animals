import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { SubmitButton, TextAreaField } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import { ExplainState } from "@/components/site/explain-state";
import { SiteLink } from "@/components/site/site-link";
import { siteUrl } from "@/env";
import {
  ADMIN_DONATIONS,
  adminDonationPath,
  adminPaymentReviewCasePath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { DonationView } from "@/server/modules/donations";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

import { adminCall } from "../../_lib/boundary";
import { DonationsDenied, DonationsFrame } from "../_components/frame";
import { LinkForm } from "../_components/link-form";
import {
  decideDonationRefundAction,
  requestDonationRefundAction,
  openOfflineDonationProofAction,
} from "../_lib/actions";

// One donation, for finance (#106): the donor, the money, the receipt, a
// new receipt link on screen, and its refunds, asked for and decided here.
// Approving or rejecting a refund needs a fresh second factor (#60), and
// nobody decides their own request.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminDonations.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const DONE = ["requested", "approved", "rejected"] as const;
const PROBLEMS = [
  "reason_required",
  "reason_too_long",
  "not_refundable",
  "refund_in_progress",
  "same_person",
  "not_requested",
  "note_required",
  "note_too_long",
  "not_rejectable",
  "cancellation_refund_required",
  "failed",
] as const;

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

export default async function Page({
  params,
  searchParams,
}: PageProps<"/admin/donations/[id]">) {
  const [actor, { id }, query, t, callout] = await Promise.all([
    currentActor(),
    params,
    searchParams,
    getTranslations("adminDonations"),
    getTranslations("common.callout"),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const view = await adminCall(
    () => as(actor).getDonation({ donationId: id }),
    adminDonationPath(id)
  );
  if (!view.ok) return <DonationsDenied />;
  const result = view.value;
  if (!result.ok) {
    return (
      <DonationsFrame title={t("title")} back={t("detail.back")}>
        <ExplainState
          title={t("detail.notFound.title")}
          back={{ href: ADMIN_DONATIONS, label: t("detail.notFound.back") }}
        >
          <p>{t("detail.notFound.body")}</p>
        </ExplainState>
      </DonationsFrame>
    );
  }
  const donation = result.donation;
  const done = DONE.find((each) => each === query["done"]);
  const problem = PROBLEMS.find((each) => each === query["problem"]);

  return (
    <DonationsFrame
      title={t("detail.title", { amount: formatPaise(donation.amountMinor) })}
      back={t("detail.back")}
    >
      {done ? (
        <OutcomeNotice
          tone="success"
          label={callout("success")}
          message={
            done === "requested"
              ? t("refund.requested")
              : t(`refund.decided.${done}`)
          }
        />
      ) : null}
      {problem ? (
        <OutcomeNotice
          tone="danger"
          label={callout("danger")}
          message={t(`refund.errors.${problem}`)}
        />
      ) : null}
      {query["proof"] === "unavailable" ? (
        <OutcomeNotice
          tone="danger"
          label={callout("danger")}
          message={t("offline.proofUnavailable")}
        />
      ) : null}
      <Details donation={donation} />
      <section aria-labelledby="link-title" className={CARD}>
        <h2 id="link-title" className="text-h4">
          {t("link.title")}
        </h2>
        {donation.receipt && !donation.receipt.cancelledAt ? (
          <>
            <p className="mt-2 text-ink-muted">{t("link.lead")}</p>
            <div className="mt-4">
              <LinkForm
                donationId={donation.id}
                origin={siteUrl().origin}
                labels={{
                  submit: t("link.submit"),
                  submitting: t("link.submitting"),
                  problems: {
                    cancelled: t("link.cancelled"),
                    failed: t("link.failed"),
                  },
                  problem: callout("danger"),
                  done: callout("success"),
                }}
              />
            </div>
          </>
        ) : (
          <p className="mt-2 text-ink-muted">
            {donation.receipt ? t("link.cancelled") : t("detail.noReceipt")}
          </p>
        )}
      </section>
      <Refunds donation={donation} />
    </DonationsFrame>
  );
}

async function Details({ donation }: { donation: DonationView }) {
  const [t, format] = await Promise.all([
    getTranslations("adminDonations"),
    getFormatter(),
  ]);
  const when = (date: Date) =>
    format.dateTime(date, { dateStyle: "medium", timeStyle: "short" });
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
      <dt className="font-semibold text-ink">{label}</dt>
      <dd className="wrap-anywhere text-ink">{value}</dd>
    </div>
  );
  const wall = !donation.showOnWall
    ? t("detail.wallOff")
    : (donation.wallName ?? t("detail.wallNoName"));
  return (
    <>
      <section aria-labelledby="donor-title" className={CARD}>
        <h2 id="donor-title" className="text-h4">
          {t("detail.donorTitle")}
        </h2>
        <dl className="mt-2 divide-y divide-border">
          {row(t("detail.name"), donation.donorName)}
          {row(t("detail.email"), donation.donorEmail)}
          {row(t("detail.type"), t(`donorTypes.${donation.donorType}`))}
          {donation.organisationName
            ? row(t("detail.organisation"), donation.organisationName)
            : null}
          {donation.organisationName
            ? row(
                t("detail.disclose"),
                donation.discloseOrganisation ? t("detail.yes") : t("detail.no")
              )
            : null}
          {row(t("detail.wall"), wall)}
          {row(
            t("detail.account"),
            donation.guest ? t("detail.guest") : t("detail.member")
          )}
        </dl>
      </section>
      <section aria-labelledby="money-title" className={CARD}>
        <h2 id="money-title" className="text-h4">
          {t("detail.moneyTitle")}
        </h2>
        <dl className="mt-2 divide-y divide-border">
          {row(t("detail.amount"), formatPaise(donation.amountMinor))}
          {row(t("detail.status"), t(`statuses.${donation.status}`))}
          {row(t("detail.started"), when(donation.createdAt))}
          {donation.capturedAt
            ? row(t("detail.captured"), when(donation.capturedAt))
            : null}
          {donation.offline ? (
            <>
              {row(
                t("offline.method"),
                t(`offline.methods.${donation.offline.method}`)
              )}
              {row(t("offline.reference"), donation.offline.reference)}
              {row(t("offline.receivedOn"), donation.offline.receivedOn)}
              {row(
                t("offline.proofStatus"),
                t(`offline.proofStatuses.${donation.offline.proofStatus}`)
              )}
            </>
          ) : null}
          {donation.payment?.gatewayPaymentId
            ? row(t("detail.payment"), donation.payment.gatewayPaymentId)
            : null}
          {donation.receipt
            ? row(t("detail.receiptNumber"), donation.receipt.number)
            : row(t("detail.receiptTitle"), t("detail.noReceipt"))}
          {donation.receipt
            ? row(t("detail.receiptIssued"), when(donation.receipt.issuedAt))
            : null}
          {donation.receipt?.cancelledAt
            ? row(
                t("detail.receiptCancelled"),
                when(donation.receipt.cancelledAt)
              )
            : null}
        </dl>
        {donation.offline?.proofStatus === "clean" ? (
          <form action={openOfflineDonationProofAction} className="mt-4">
            <input type="hidden" name="donationId" value={donation.id} />
            <SubmitButton
              variant="secondary"
              pendingLabel={t("link.submitting")}
            >
              {t("offline.openProof")}
            </SubmitButton>
          </form>
        ) : donation.offline ? (
          <p className="mt-3 text-ink-muted">{t("offline.proofUnavailable")}</p>
        ) : null}
        {donation.reviewCases.length > 0 ? (
          <>
            <h3 className="mt-6 text-h5">{t("detail.reviewTitle")}</h3>
            <ul className="mt-2 space-y-2">
              {donation.reviewCases.map((each) => (
                <li
                  key={each.id}
                  className="flex flex-wrap items-center gap-x-2"
                >
                  <SiteLink
                    href={adminPaymentReviewCasePath(each.id)}
                    className="inline-flex min-h-11 items-center text-link underline"
                  >
                    {t("detail.reviewOpen")}
                  </SiteLink>
                  <span className="text-ink-muted">
                    {t(`detail.reviewReasons.${reviewReason(each.reason)}`)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </>
  );
}

/** The review reasons a donation's payment can have (#106). */
function reviewReason(
  reason: DonationView["reviewCases"][number]["reason"]
): "amount_mismatch" | "already_paid" | "donation_expired" {
  return reason === "donation_expired" || reason === "already_paid"
    ? reason
    : "amount_mismatch";
}

async function Refunds({ donation }: { donation: DonationView }) {
  const [t, format] = await Promise.all([
    getTranslations("adminDonations"),
    getFormatter(),
  ]);
  return (
    <section aria-labelledby="refunds-title" className={CARD}>
      <h2 id="refunds-title" className="text-h4">
        {t("detail.refundsTitle")}
      </h2>
      {donation.refunds.length === 0 ? (
        <p className="mt-2 text-ink-muted">{t("detail.noRefunds")}</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {donation.refunds.map((each) => (
            <li
              key={each.id}
              className="rounded-2xl border-2 border-border p-4"
            >
              <p className="font-semibold text-ink">
                {formatPaise(each.amountMinor)}
              </p>
              <p className="text-ink-muted">
                {[
                  t(`detail.refundKinds.${each.kind}`),
                  t(`detail.refundStatuses.${each.status}`),
                  format.dateTime(each.requestedAt, { dateStyle: "medium" }),
                ].join(" · ")}
              </p>
              {each.status === "requested" ? (
                <form
                  action={decideDonationRefundAction}
                  className="mt-4 flex flex-col gap-4"
                >
                  <input type="hidden" name="donationId" value={donation.id} />
                  <input type="hidden" name="refundId" value={each.id} />
                  <TextAreaField
                    id={`refund-note-${each.id}`}
                    name="note"
                    rows={2}
                    maxLength={500}
                    label={t("refund.noteLabel")}
                  />
                  <div className="flex flex-wrap gap-3">
                    <SubmitButton
                      name="decision"
                      value="approve"
                      pendingLabel={t("refund.submitting")}
                    >
                      {t("refund.approve")}
                    </SubmitButton>
                    <SubmitButton
                      name="decision"
                      value="reject"
                      variant="secondary"
                      pendingLabel={t("refund.submitting")}
                    >
                      {t("refund.reject")}
                    </SubmitButton>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {donation.canRequestRefund ? (
        <form
          action={requestDonationRefundAction}
          className="mt-6 flex flex-col gap-4"
        >
          <h3 className="text-h5">{t("refund.title")}</h3>
          <p className="text-ink-muted">{t("refund.lead")}</p>
          <input type="hidden" name="donationId" value={donation.id} />
          <TextAreaField
            id="donation-refund-reason"
            name="reason"
            rows={3}
            maxLength={500}
            required
            label={t("refund.reason.label")}
            hint={t("refund.reason.hint")}
          />
          <div>
            <SubmitButton
              variant="secondary"
              pendingLabel={t("refund.submitting")}
            >
              {t("refund.submit")}
            </SubmitButton>
          </div>
        </form>
      ) : null}
    </section>
  );
}
