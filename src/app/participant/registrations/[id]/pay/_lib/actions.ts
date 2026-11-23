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
import { payMyRegistrationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import type { PayForMyRegistrationResult } from "@/server/modules/participants";

import { payOutcome } from "./pay-outcome";

// An adult's pay page's server actions (#78): confirm a free place, and
// the Checkout island's three (#77), which the page binds to the
// registration: open the order, the fallback's test checkout, and confirm
// what Checkout hands back. Every message is translated here, so the
// island ships no catalogue. A use case that throws is never shown to the
// payer: it is logged (class only) and the page says nothing was charged,
// or that the payment is confirmed once the gateway tells us.

async function signedInUser() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

/** One of participant.payment.error's messages, for the island. */
async function refusal(
  key: Exclude<PayForMyRegistrationResult, { ok: true }>["error"]
): Promise<PayView> {
  const t = await getTranslations("participant.payment.error");
  return { kind: "error", message: t(key) };
}

/** One of payments.pay.error's messages, shared with the school's page. */
async function problem(
  key: "not_found" | "invalid_signature" | "confirm_failed" | "failed"
): Promise<PayView> {
  const t = await getTranslations("payments.pay.error");
  return { kind: "error", message: t(key) };
}

/**
 * Pays for the signed-in adult's registration when it is free, then comes
 * back to its pay page saying what happened. A fee is paid through the
 * Checkout island instead (startMyPaymentAction).
 */
export async function payForMyRegistrationAction(
  registrationId: string
): Promise<void> {
  const actor = await signedInUser();
  let result: PayForMyRegistrationResult;
  try {
    result = await as(actor).payForMyRegistration({ registrationId });
  } catch (error) {
    console.error(`payForMyRegistration failed: ${errorSummaryForLogs(error)}`);
    result = { ok: false, error: "gateway_unavailable" };
  }
  const query = new URLSearchParams({
    done: payOutcome(result),
    n: Date.now().toString(36),
  });
  redirect(
    `${payMyRegistrationPath(registrationId)}?${query.toString()}`,
    RedirectType.replace
  );
}

/**
 * Opens (or reuses) the gateway order for the registration's fee, for the
 * island to open. A registration found paid, or a place that turned out
 * free, goes back to the pay page, which shows its number.
 */
export async function startMyPaymentAction(
  registrationId: string
): Promise<PayView> {
  const actor = await signedInUser();
  let result: PayForMyRegistrationResult;
  try {
    result = await as(actor).payForMyRegistration({ registrationId });
  } catch (error) {
    console.error(`payForMyRegistration failed: ${errorSummaryForLogs(error)}`);
    return refusal("gateway_unavailable");
  }
  if (!result.ok) return refusal(result.error);
  if (result.kind !== "checkout") {
    redirect(payMyRegistrationPath(registrationId), RedirectType.replace);
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
 * What Checkout handed back: checked against the order of the batch that
 * holds the registration and the gateway's record, then back to the pay
 * page, which shows the registration number. Only a problem comes back.
 * The batch is the one holding the registration, whatever the island
 * names.
 */
export async function confirmMyPaymentAction(
  registrationId: string,
  _batchId: string,
  answer: CheckoutReturn
): Promise<PayView> {
  const actor = await signedInUser();
  const paid = checkoutReturnFrom(answer);
  if (!paid) return problem("failed");
  let result;
  try {
    result = await as(actor).confirmMyPayment({ registrationId, ...paid });
  } catch (error) {
    // Most often the gateway didn't answer: the webhook, or paying again,
    // still confirms a payment that went through.
    console.error(`confirmMyPayment failed: ${errorSummaryForLogs(error)}`);
    return problem("confirm_failed");
  }
  if (!result.ok) {
    return problem(result.error === "invalid_input" ? "failed" : result.error);
  }
  if (result.outcome !== "captured" && result.outcome !== "already_captured") {
    // Not paid in full on the gateway's record (yet): nothing confirmed.
    return problem("confirm_failed");
  }
  redirect(payMyRegistrationPath(registrationId), RedirectType.replace);
}

/**
 * The fallback gateway's test checkout: the tester pays the registration's
 * order in full, or declines. The use case refuses wherever the fallback
 * isn't the gateway, which is never production
 * (src/server/ports/payment-gateway-select.ts).
 */
export async function payMyTestCheckoutAction(
  registrationId: string,
  _batchId: string,
  outcome: "pay" | "decline"
): Promise<TestCheckoutResult> {
  const actor = await signedInUser();
  const t = await getTranslations("payments.pay");
  let result;
  try {
    result = await as(actor).payMyTestCheckout({ registrationId, outcome });
  } catch (error) {
    console.error(`payMyTestCheckout failed: ${errorSummaryForLogs(error)}`);
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
