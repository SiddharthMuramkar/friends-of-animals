import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { feeText } from "@/components/competitions/fee-text";
import { Checkout } from "@/components/payments/checkout";
import { checkoutLabels } from "@/components/payments/checkout-labels";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  APP_ROUTES,
  institutionCompetitionsPath,
  institutionRegistrationPath,
  paymentBatchPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { Money } from "@/server/ports/payment-gateway";

import {
  actingInstitutions,
  chooseInstitution,
} from "../../../competitions/_lib/register-state";
import {
  confirmPaymentAction,
  payTestCheckoutAction,
  startPaymentAction,
} from "./_lib/actions";

// The pay page (#77): what an institution owes for its waiting students,
// and the button that opens the gateway's checkout. Its CSP (Razorpay's
// origins) and Permissions-Policy come with the document, so links to it
// are plain <a> elements: a full load, never a client-side navigation.

// Render the document on each request so its scripts carry the CSP nonce
// (#65): `instant = false` lets it build with an empty static shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.pay.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/institution/registrations/[ref]/pay">;

export default async function Page({ params, searchParams }: Props) {
  await connection();
  return (
    <Section hue="pink" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Header />
      {/* The fees stream in behind this boundary. */}
      <Suspense fallback={<Loading />}>
        <Pay params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Header() {
  const t = await getTranslations("payments.pay");
  return (
    <PageHeader
      eyebrow={t("eyebrow")}
      tile="pink"
      title={t("title")}
      lead={t("lead")}
    />
  );
}

async function Loading() {
  const t = await getTranslations("payments.pay");
  return <p className="mt-8 text-ink-muted">{t("loading")}</p>;
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const param = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

async function Pay({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ ref }, query, t, format, access, requestHeaders] = await Promise.all(
    [
      params,
      searchParams,
      getTranslations("payments.pay"),
      getFormatter(),
      as(actor).myAccess(),
      headers(),
    ]
  );

  const institutionId = chooseInstitution(
    actingInstitutions(access.grants),
    param(query.institution)
  );
  if (!institutionId) {
    return (
      <ExplainState
        className="mt-8"
        title={t("noInstitution.title")}
        back={{ href: APP_ROUTES.dashboard, label: t("noInstitution.back") }}
      >
        <p>{t("noInstitution.body")}</p>
      </ExplainState>
    );
  }
  const result = await as(actor).getFeesToPay({
    institutionId,
    reference: ref,
  });
  if (!result.ok) {
    return (
      <ExplainState
        className="mt-8"
        title={t("notFound.title")}
        back={{
          href: institutionCompetitionsPath(institutionId),
          label: t("notFound.back"),
        }}
      >
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }

  const { fees } = result;
  const students = institutionRegistrationPath(fees.reference, institutionId);
  const rupees = (money: Money) =>
    money.amountMinor === 0n
      ? t("free")
      : feeText(
          {
            route: "institution",
            kind: "amount",
            paise: money.amountMinor.toString(),
          },
          {
            t: () => t("free"),
            format: { number: (value, name) => format.number(value, name) },
          }
        );
  const back = (
    <p>
      <ButtonLink href={students} variant="quiet" className="-ms-5">
        {t("back")}
      </ButtonLink>
    </p>
  );
  const lastPaid = fees.lastPaidBatchId ? (
    <p>
      <ButtonLink
        href={paymentBatchPath(
          fees.reference,
          fees.lastPaidBatchId,
          institutionId
        )}
        variant="secondary"
      >
        {t("lastPaid")}
      </ButtonLink>
    </p>
  ) : null;

  let body;
  if (!fees.fee || !fees.total) {
    body = (
      <ExplainState
        title={t("feeNotSet.title")}
        back={{ href: students, label: t("back") }}
      >
        <p>{t("feeNotSet.body")}</p>
      </ExplainState>
    );
  } else if (fees.students === 0) {
    body = (
      <>
        <ExplainState
          title={t("nothingToPay.title")}
          back={{ href: students, label: t("back") }}
        >
          <p>{t("nothingToPay.body")}</p>
        </ExplainState>
        {lastPaid}
      </>
    );
  } else {
    const free = fees.fee.amountMinor === 0n;
    const labels = await checkoutLabels({
      submit: free
        ? t("confirmFree", { count: fees.students })
        : t("pay", { total: rupees(fees.total) }),
      submitting: free ? t("confirmingFree") : t("paying"),
      confirming: t("confirming"),
    });
    body = (
      <>
        <section aria-labelledby="pay-summary" className={CARD}>
          <SectionHeading id="pay-summary" title={t("summaryTitle")} />
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 text-ink">
            <dt>{t("students")}</dt>
            <dd className="text-end font-semibold">{fees.students}</dd>
            <dt>{t("fee")}</dt>
            <dd className="text-end font-display font-semibold">
              {rupees(fees.fee)}
            </dd>
            <dt className="border-t-2 border-border pt-3 font-semibold">
              {t("total")}
            </dt>
            <dd className="border-t-2 border-border pt-3 text-end font-display text-lead font-semibold">
              {rupees(fees.total)}
            </dd>
          </dl>
        </section>
        {free ? <p className="text-ink">{t("freeBody")}</p> : null}
        <Checkout
          start={startPaymentAction.bind(null, institutionId, fees.reference)}
          confirm={confirmPaymentAction.bind(
            null,
            institutionId,
            fees.reference
          )}
          answerTestCheckout={payTestCheckoutAction.bind(null, institutionId)}
          nonce={requestHeaders.get("x-nonce")}
          labels={labels}
        />
        {lastPaid}
      </>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-8">
      <div>
        <p className="text-lead font-semibold text-ink wrap-anywhere">
          {t("for", {
            institution: fees.institution.name,
            competition: fees.competition.name,
          })}
        </p>
        <p className="mt-1 font-mono text-sm text-ink-muted">
          {t("reference", { reference: fees.reference })}
        </p>
      </div>
      {body}
      {back}
    </div>
  );
}
