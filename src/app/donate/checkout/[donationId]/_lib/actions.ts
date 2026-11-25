"use server";

import { getTranslations } from "next-intl/server";
import { redirect, RedirectType } from "next/navigation";

import {
  checkoutReturnFrom,
  checkoutView,
  type CheckoutReturn,
  type PayView,
  type TestCheckoutResult,
} from "@/components/payments/pay-view";
import { donationThankYouPath } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

// A donation's checkout page's Server Actions (#106): the Checkout
// island's three, which the page binds to the donation and its checkout
// token: open the order, the fallback's test checkout, and confirm what
// Checkout hands back. Whoever holds the token may use them, signed in or
// not. A use case that throws is never shown to the donor: it is logged by
// class only, and the page says nothing was charged, or sends them to the
// thank-you page, which says what the gateway knows.

async function problem(
  key: "not_found" | "gateway_unavailable" | "superseded" | "failed"
): Promise<PayView> {
  const t = await getTranslations("donationCheckout.errors");
  return { kind: "error", message: t(key) };
}

/** Opens (or reuses) the donation's order, for the island to open. */
export async function startDonationPaymentAction(
  donationId: string,
  checkoutToken: string
): Promise<PayView> {
  let result;
  try {
    result = await as(await currentActor()).payForDonation({
      donationId,
      checkoutToken,
    });
  } catch (error) {
    console.error(`payForDonation failed: ${errorSummaryForLogs(error)}`);
    return problem("gateway_unavailable");
  }
  if (!result.ok) {
    return problem(
      result.error === "invalid_input" ? "not_found" : result.error
    );
  }
  if (result.kind === "settled") {
    redirect(
      donationThankYouPath(donationId, checkoutToken),
      RedirectType.replace
    );
  }
  return {
    kind: "checkout",
    batchId: result.batchId,
    checkout: checkoutView(
      result.checkout,
      formatPaise(result.checkout.amount.amountMinor)
    ),
  };
}

/**
 * What Checkout handed back: checked against the donation's order and the
 * gateway's record, then on to the thank-you page, which says what
 * happened. Only a bad signature comes back here.
 */
export async function confirmDonationPaymentAction(
  donationId: string,
  checkoutToken: string,
  _batchId: string,
  answer: CheckoutReturn
): Promise<PayView> {
  const paid = checkoutReturnFrom(answer);
  if (!paid) return problem("failed");
  let result;
  try {
    result = await as(await currentActor()).confirmDonationCheckout({
      donationId,
      checkoutToken,
      ...paid,
    });
  } catch (error) {
    // Most often the gateway didn't answer: the webhook still captures a
    // payment that went through, and the thank-you page asks again.
    console.error(
      `confirmDonationCheckout failed: ${errorSummaryForLogs(error)}`
    );
    result = null;
  }
  if (result && !result.ok) {
    return problem(result.error === "not_found" ? "not_found" : "failed");
  }
  redirect(
    donationThankYouPath(donationId, checkoutToken),
    RedirectType.replace
  );
}

/**
 * The fallback gateway's test checkout: the tester pays the donation's
 * order in full, or declines. The use case refuses wherever the fallback
 * isn't the gateway, which is never production.
 */
export async function donationTestCheckoutAction(
  donationId: string,
  checkoutToken: string,
  _batchId: string,
  outcome: "pay" | "decline"
): Promise<TestCheckoutResult> {
  const t = await getTranslations("payments.pay");
  let result;
  try {
    result = await as(await currentActor()).payDonationTestCheckout({
      donationId,
      checkoutToken,
      outcome,
    });
  } catch (error) {
    console.error(
      `payDonationTestCheckout failed: ${errorSummaryForLogs(error)}`
    );
    return { ok: false, message: t("error.failed") };
  }
  if (!result.ok) {
    const key =
      result.error === "unavailable"
        ? "testCheckout.unavailable"
        : result.error === "not_found"
          ? "error.not_found"
          : "error.failed";
    return { ok: false, message: t(key) };
  }
  if (result.outcome === "declined") {
    return { ok: false, message: t("error.payment_failed") };
  }
  return { ok: true, paymentId: result.paymentId, signature: result.signature };
}
