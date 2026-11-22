"use server";

import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { feeText } from "@/components/competitions/fee-text";
import { paymentBatchPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import type { CheckoutParams } from "@/server/ports/payment-gateway";

import type {
  CheckoutReturn,
  CheckoutView,
  PayView,
  TestCheckoutResult,
} from "./pay-view";

// The pay page's server actions (#77): open the batch's order, confirm
// what Checkout hands back, and the fallback's test checkout. Every
// message is translated here, so the island ships no catalogue. A use
// case that throws is never shown to the payer: a refusal of the actor
// says "forbidden", anything else is logged (class only) and says that
// nothing was charged, or that the payment is confirmed once the gateway
// tells us.

type ErrorKey =
  | "institution_not_verified"
  | "nothing_to_pay"
  | "fee_not_set"
  | "gateway_unavailable"
  | "superseded"
  | "not_found"
  | "invalid_signature"
  | "confirm_failed"
  | "payment_failed"
  | "forbidden"
  | "failed";

async function problem(key: ErrorKey): Promise<PayView> {
  const t = await getTranslations("payments.pay.error");
  return { kind: "error", message: t(key) };
}

/** "forbidden" for a refused actor; anything else is logged. */
function thrown(useCase: string, error: unknown): "forbidden" | undefined {
  if (error instanceof DomainError && error.code === "forbidden") {
    return "forbidden";
  }
  console.error(`${useCase} failed: ${errorSummaryForLogs(error)}`);
  return undefined;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function signedInUser() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

async function checkoutView(checkout: CheckoutParams): Promise<CheckoutView> {
  const [format, t] = await Promise.all([
    getFormatter(),
    getTranslations("payments.pay"),
  ]);
  return {
    gateway: checkout.gateway,
    orderId: checkout.orderId,
    amountMinor: checkout.amount.amountMinor.toString(),
    amountText: feeText(
      {
        route: "institution",
        kind: "amount",
        paise: checkout.amount.amountMinor.toString(),
      },
      {
        t: () => t("free"),
        format: { number: (value, name) => format.number(value, name) },
      }
    ),
    description: checkout.description,
    publicKey: checkout.publicKey,
  };
}

/**
 * Opens (or reuses) the gateway order for every waiting student's fee, or
 * confirms them at once when the competition is free.
 */
export async function startPaymentAction(formData: FormData): Promise<PayView> {
  const actor = await signedInUser();
  const input = {
    institutionId: field(formData, "institutionId"),
    reference: field(formData, "reference"),
  };
  let result;
  try {
    result = await as(actor).payInstitutionFees(input);
  } catch (error) {
    return problem(thrown("payInstitutionFees", error) ?? "failed");
  }
  if (!result.ok) {
    return problem(result.error === "invalid_input" ? "failed" : result.error);
  }
  if (result.kind === "confirmed_free") {
    const t = await getTranslations("payments.pay");
    return {
      kind: "confirmed_free",
      message: t("confirmedFree", { count: result.confirmed }),
    };
  }
  return {
    kind: "checkout",
    batchId: result.batchId,
    checkout: await checkoutView(result.checkout),
  };
}

/**
 * What Checkout handed back after a payment: checked against the batch's
 * order and the gateway's record, then on to the batch's page. Only a
 * problem comes back; success redirects.
 */
export async function confirmPaymentAction(
  input: {
    institutionId: string;
    reference: string;
    batchId: string;
  } & CheckoutReturn
): Promise<PayView> {
  const actor = await signedInUser();
  const { institutionId, reference, batchId, paymentId, signature } = input;
  let result;
  try {
    result = await as(actor).confirmCheckout({
      institutionId,
      batchId,
      paymentId,
      signature,
    });
  } catch (error) {
    // Most often the gateway didn't answer: the webhook, or paying again,
    // still confirms a payment that went through.
    return problem(thrown("confirmCheckout", error) ?? "confirm_failed");
  }
  if (!result.ok) {
    return problem(result.error === "invalid_input" ? "failed" : result.error);
  }
  redirect(paymentBatchPath(reference, batchId, institutionId));
}

/**
 * The fallback gateway's test checkout: the tester pays the batch's order
 * in full, or declines. The use case refuses wherever the fallback isn't
 * the gateway, which is never production
 * (src/server/ports/payment-gateway-select.ts).
 */
export async function payTestCheckoutAction(input: {
  institutionId: string;
  batchId: string;
  outcome: "pay" | "decline";
}): Promise<TestCheckoutResult> {
  const actor = await signedInUser();
  const t = await getTranslations("payments.pay");
  let result;
  try {
    result = await as(actor).payTestCheckout(input);
  } catch (error) {
    return {
      ok: false,
      message: t(`error.${thrown("payTestCheckout", error) ?? "failed"}`),
    };
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
