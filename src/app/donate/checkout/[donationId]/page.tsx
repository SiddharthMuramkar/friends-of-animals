import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Checkout } from "@/components/payments/checkout";
import { checkoutLabels } from "@/components/payments/checkout-labels";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { donationThankYouPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

import {
  confirmDonationPaymentAction,
  donationTestCheckoutAction,
  startDonationPaymentAction,
} from "./_lib/actions";

// A donation's checkout (#106): the amount, and the Checkout island (#77)
// that opens the gateway's checkout for the donation's order. Reached with
// the donation's checkout token (`?t=`), signed in or not. Its CSP, with
// Razorpay's origins, comes from src/proxy.ts and its Permissions-Policy
// from next.config.ts, so every way in is a full load: the donate form
// moves here with a redirect from its Server Action. Never cached, indexed
// or sent as a referrer (src/lib/security-headers.ts).

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("donationCheckout.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const HUE = ROUTES.donate.hue;

type Props = PageProps<"/donate/checkout/[donationId]">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("donationCheckout");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Pay params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Pay({ params, searchParams }: Props) {
  const [{ donationId }, query, t, requestHeaders] = await Promise.all([
    params,
    searchParams,
    getTranslations("donationCheckout"),
    headers(),
  ]);
  const checkoutToken = typeof query["t"] === "string" ? query["t"] : "";
  const found = await as(await currentActor()).getDonationOutcome({
    donationId,
    checkoutToken,
  });
  if (!found.ok) {
    return (
      <ExplainState
        title={t("errors.not_found")}
        back={{ href: ROUTES.donate.path, label: t("thankYou.home") }}
        headingLevel="h1"
      >
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }
  const { outcome } = found;
  if (outcome.status !== "pending" && outcome.status !== "failed") {
    redirect(donationThankYouPath(donationId, checkoutToken));
  }
  const amount = formatPaise(outcome.amountMinor);
  const labels = await checkoutLabels({
    submit: t("pay", { amount }),
    submitting: t("paying"),
    confirming: t("confirming"),
  });
  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile={HUE}
        title={t("title", { amount })}
        lead={t("lead")}
      />
      <div className="mt-8 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6">
        <Checkout
          start={startDonationPaymentAction.bind(
            null,
            donationId,
            checkoutToken
          )}
          confirm={confirmDonationPaymentAction.bind(
            null,
            donationId,
            checkoutToken
          )}
          answerTestCheckout={donationTestCheckoutAction.bind(
            null,
            donationId,
            checkoutToken
          )}
          nonce={requestHeaders.get("x-nonce")}
          labels={labels}
        />
      </div>
      <div className="mt-8">
        <ButtonLink href={ROUTES.donate.path} variant="secondary">
          {t("back")}
        </ButtonLink>
      </div>
    </>
  );
}
