// The Checkout island's words (#77), translated on the server: the page's
// own button words plus what every pay page shares (payments.pay).

import { getTranslations } from "next-intl/server";

import type { CheckoutLabels } from "./checkout";

export async function checkoutLabels(
  button: Pick<CheckoutLabels, "submit" | "submitting" | "confirming">
): Promise<CheckoutLabels> {
  const [t, callout] = await Promise.all([
    getTranslations("payments.pay"),
    getTranslations("common.callout"),
  ]);
  return {
    ...button,
    checkoutName: t("checkoutName"),
    checkoutUnavailable: t("error.checkout_unavailable"),
    paymentFailed: t("error.payment_failed"),
    problem: callout("danger"),
    success: callout("success"),
    testCheckout: {
      title: t("testCheckout.title"),
      body: t("testCheckout.body"),
      amount: t("testCheckout.amount"),
      pay: t("testCheckout.pay"),
      paying: t("testCheckout.paying"),
      decline: t("testCheckout.decline"),
      declining: t("testCheckout.declining"),
    },
  };
}
