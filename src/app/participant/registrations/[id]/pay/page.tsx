import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import { Checkout } from "@/components/payments/checkout";
import { checkoutLabels } from "@/components/payments/checkout-labels";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES, guardianChildConsentsPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

import {
  confirmMyPaymentAction,
  payForMyRegistrationAction,
  payMyTestCheckoutAction,
  startMyPaymentAction,
} from "./_lib/actions";
import { isPayOutcome } from "./_lib/pay-outcome";

// Paying for an adult's own registration (#78), or a guardian's child's
// (#81): the fee, and the Checkout island (#77) that opens a payment batch
// of one and the gateway's checkout, or the button that confirms a free
// place at once. A registration waiting for a guardian, or one a teen's
// guardian pays, says so instead. Its CSP (Razorpay's origins) and
// Permissions-Policy come with the document, so every way in is a full
// load: links to it are plain <a> elements, and the register form loads it
// with window.location once registered.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("participant.payment.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const HUE = ROUTES.participate.hue;

const CARD =
  "mt-8 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

type Props = PageProps<"/participant/registrations/[id]/pay">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("participant.payment");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Pay params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Pay({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, query, t, callout, requestHeaders] = await Promise.all([
    params,
    searchParams,
    getTranslations("participant.payment"),
    getTranslations("common.callout"),
    headers(),
  ]);
  // Only the member's own registrations: anyone else's is not found.
  const mine = (await as(actor).listMyRegistrations()).find(
    (registration) => registration.registrationId === id
  );
  if (!mine) notFound();
  const done = isPayOutcome(query["done"]) ? query["done"] : null;
  const n = typeof query["n"] === "string" ? query["n"] : "";
  const competition = mine.competition.name;
  const fee = mine.amountDue?.amountMinor;
  // The island's words, when there is a fee to pay through it; a free
  // place is confirmed with a plain form.
  const labels =
    !mine.registrationNumber && fee
      ? await checkoutLabels({
          submit: t("pay", { amount: formatPaise(fee) }),
          submitting: t("paying"),
          confirming: t("confirming"),
        })
      : null;

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile={HUE}
        title={t("title", { competition })}
      />
      {done && done !== "confirmed" ? (
        <div className="mt-8">
          <OutcomeNotice
            key={n}
            tone={done === "checkout" ? "success" : "danger"}
            label={callout(done === "checkout" ? "success" : "danger")}
            message={
              done === "checkout" ? t("checkoutReady") : t(`error.${done}`)
            }
          />
        </div>
      ) : null}
      {mine.registrationNumber ? (
        <div className={CARD}>
          <p className="text-lead font-semibold text-ink">
            {t("confirmed", { number: mine.registrationNumber })}
          </p>
          <p className="mt-2 text-ink-muted">{t("writeNumber")}</p>
        </div>
      ) : mine.amountDue ? (
        <div className={CARD}>
          <p className="text-lead font-semibold text-ink">
            {mine.amountDue.amountMinor === 0n
              ? t("free")
              : t("amount", {
                  amount: formatPaise(mine.amountDue.amountMinor),
                })}
          </p>
          {labels ? (
            <div className="mt-6">
              <Checkout
                start={startMyPaymentAction.bind(null, mine.registrationId)}
                confirm={confirmMyPaymentAction.bind(null, mine.registrationId)}
                answerTestCheckout={payMyTestCheckoutAction.bind(
                  null,
                  mine.registrationId
                )}
                nonce={requestHeaders.get("x-nonce")}
                labels={labels}
              />
            </div>
          ) : (
            <form
              action={payForMyRegistrationAction.bind(
                null,
                mine.registrationId
              )}
              className="mt-6"
            >
              <SubmitButton pendingLabel={t("confirming")}>
                {t("confirmFree")}
              </SubmitButton>
            </form>
          )}
        </div>
      ) : mine.heldFor === "unavailable" ? (
        <p className={CARD}>{t("error.unavailable")}</p>
      ) : mine.heldFor !== null || mine.status === "pending_guardian" ? (
        <p className={CARD}>
          {t(
            mine.heldFor === "consent"
              ? "error.participation_consent_required"
              : "error.awaiting_guardian"
          )}
        </p>
      ) : mine.status === "pending_payment" ? (
        <p className={CARD}>{t("guardianPays")}</p>
      ) : (
        <p className={CARD}>{t("error.nothing_to_pay")}</p>
      )}
      <div className="mt-8">
        {mine.childId &&
        (mine.heldFor === "consent" ||
          done === "participation_consent_required") ? (
          <ButtonLink
            href={guardianChildConsentsPath(mine.childId)}
            className="me-3"
          >
            {t("manageConsents")}
          </ButtonLink>
        ) : null}
        <ButtonLink href={APP_ROUTES.participant} variant="secondary">
          {t("back")}
        </ButtonLink>
      </div>
    </>
  );
}
