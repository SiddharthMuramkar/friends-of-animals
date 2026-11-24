import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  donationCheckoutPath,
  donationThankYouPath,
  RECEIPT_REQUEST,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

// A donation's thank-you page (#106), for whoever holds its checkout token:
// what happened to the payment. A captured donation shows its receipt
// number; the receipt itself goes by its 7-day link, emailed to the donor.
// Never cached, indexed or sent as a referrer (src/lib/security-headers.ts).

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("donationCheckout.meta");
  return { title: t("thankYouTitle"), robots: { index: false, follow: false } };
}

const HUE = ROUTES.donate.hue;

type Props = PageProps<"/donate/thank-you">;

export default async function Page({ searchParams }: Props) {
  const t = await getTranslations("donationCheckout");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Outcome searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Outcome({ searchParams }: Pick<Props, "searchParams">) {
  const [query, t] = await Promise.all([
    searchParams,
    getTranslations("donationCheckout"),
  ]);
  const donationId = typeof query["d"] === "string" ? query["d"] : "";
  const checkoutToken = typeof query["t"] === "string" ? query["t"] : "";
  const found = await as(await currentActor()).getDonationOutcome({
    donationId,
    checkoutToken,
  });
  const home = { href: ROUTES.donate.path, label: t("thankYou.home") };
  if (!found.ok) {
    return (
      <ExplainState title={t("errors.not_found")} back={home} headingLevel="h1">
        <p>{t("thankYou.expired.body")}</p>
      </ExplainState>
    );
  }
  const { outcome } = found;
  const amount = formatPaise(outcome.amountMinor);

  if (outcome.foreignRefund && outcome.receiptNumber === null) {
    return (
      <ExplainState
        title={t("thankYou.foreign.title")}
        back={home}
        headingLevel="h1"
      >
        <p>{t("thankYou.foreign.body", { amount })}</p>
      </ExplainState>
    );
  }
  switch (outcome.status) {
    case "captured":
    case "partially_refunded":
      return (
        <>
          <PageHeader
            eyebrow={t("thankYou.eyebrow")}
            tile={HUE}
            title={t("thankYou.captured.title", { amount })}
          />
          <div className="mt-8 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6">
            <p className="text-lead text-ink">
              {t("thankYou.captured.body", {
                number: outcome.receiptNumber ?? "",
              })}
            </p>
            <p className="mt-4">
              <ButtonLink href={RECEIPT_REQUEST} variant="secondary">
                {t("thankYou.captured.lost")}
              </ButtonLink>
            </p>
          </div>
          <div className="mt-8">
            <ButtonLink href={ROUTES.donate.path} variant="quiet">
              {t("thankYou.home")}
            </ButtonLink>
          </div>
        </>
      );
    case "pending":
      return (
        <ExplainState
          title={t("thankYou.pending.title")}
          back={{
            href: donationThankYouPath(donationId, checkoutToken),
            label: t("thankYou.pending.reload"),
          }}
          headingLevel="h1"
        >
          <p>{t("thankYou.pending.body", { amount })}</p>
        </ExplainState>
      );
    case "failed":
      return (
        <ExplainState
          title={t("thankYou.failed.title")}
          back={{
            href: donationCheckoutPath(donationId, checkoutToken),
            label: t("thankYou.failed.retry"),
          }}
          headingLevel="h1"
        >
          <p>{t("thankYou.failed.body")}</p>
        </ExplainState>
      );
    case "expired":
      return (
        <ExplainState
          title={t("thankYou.expired.title")}
          back={{
            href: ROUTES.donate.path,
            label: t("thankYou.expired.again"),
          }}
          headingLevel="h1"
        >
          <p>{t("thankYou.expired.body")}</p>
        </ExplainState>
      );
    case "refund_pending":
    case "refunded":
      return (
        <ExplainState
          title={
            outcome.foreignRefund
              ? t("thankYou.foreign.title")
              : t("thankYou.refunded.title")
          }
          back={home}
          headingLevel="h1"
        >
          <p>
            {outcome.foreignRefund
              ? t("thankYou.foreign.body", { amount })
              : t("thankYou.refunded.body", { amount })}
          </p>
        </ExplainState>
      );
  }
}
