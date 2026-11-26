import { getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { connection } from "next/server";
import { headers } from "next/headers";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { SiteLink } from "@/components/site/site-link";
import { Checkout } from "@/components/payments/checkout";
import { checkoutLabels } from "@/components/payments/checkout-labels";
import { as, currentActor } from "@/server/app";
import { recurringDonationPath, DASHBOARD_DONATIONS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import {
  startRecurringCheckoutAction,
  confirmRecurringCheckoutAction,
  answerRecurringTestCheckoutAction,
} from "./actions";

export const instant = false;
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id } = await params;
  const found = await as(actor).getMyRecurringDonation({ id });
  if (!found.ok) notFound();
  if (
    found.recurring.status !== "pending_authorisation" ||
    found.recurring.cancelRequestedAt
  )
    redirect(recurringDonationPath(id));
  const t = await getTranslations("donorDashboard");
  const nonce = (await headers()).get("x-nonce");
  const labels = await checkoutLabels({
    submit: t("authorise"),
    submitting: t("authorising"),
    confirming: t("confirming"),
  });
  return (
    <Section hue="red" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        title={t("checkoutTitle", {
          amount: formatPaise(found.recurring.amountMinor),
        })}
        lead={t("checkoutLead")}
      />
      <div className="my-8 rounded-3xl bg-surface border-2 border-border p-6">
        <Checkout
          start={startRecurringCheckoutAction.bind(null, id)}
          confirm={confirmRecurringCheckoutAction.bind(null, id)}
          answerTestCheckout={answerRecurringTestCheckoutAction.bind(null, id)}
          labels={labels}
          nonce={nonce}
        />
      </div>
      <SiteLink className="text-link underline" href={DASHBOARD_DONATIONS}>
        {t("back")}
      </SiteLink>
    </Section>
  );
}
