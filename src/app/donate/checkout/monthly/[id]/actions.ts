"use server";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import type {
  PayView,
  CheckoutReturn,
  TestCheckoutResult,
} from "@/components/payments/pay-view";
import { recurringDonationPath } from "@/lib/app-routes";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { errorSummaryForLogs } from "@/server/errors";

async function problem() {
  const t = await getTranslations("donorDashboard.errors");
  return { kind: "error", message: t("generic") } as const;
}
export async function startRecurringCheckoutAction(
  id: string
): Promise<PayView> {
  const found = await as(await currentActor()).getMyRecurringDonation({ id });
  if (!found.ok || !found.checkout) return problem();
  const { recurring: row, checkout } = found;
  if (row.status !== "pending_authorisation" || row.cancelRequestedAt)
    redirect(recurringDonationPath(id));
  return {
    kind: "checkout",
    batchId: id,
    checkout: {
      gateway: row.gateway,
      orderId: checkout.subscriptionId,
      subscriptionId: checkout.subscriptionId,
      publicKey: checkout.keyId || null,
      description: checkout.description,
      amountMinor: row.amountMinor.toString(),
      amountText: formatPaise(row.amountMinor),
    },
  };
}
export async function confirmRecurringCheckoutAction(
  id: string,
  _batchId: string,
  paid: CheckoutReturn
): Promise<PayView> {
  try {
    const found = await as(await currentActor()).confirmRecurringCheckout({
      id,
      paymentId: paid.paymentId,
      signature: paid.signature,
    });
    if (!found.ok) return problem();
  } catch (error) {
    console.error("Monthly checkout confirmation:", errorSummaryForLogs(error));
    return problem();
  }
  redirect(recurringDonationPath(id));
}
export async function answerRecurringTestCheckoutAction(
  id: string,
  _batchId: string,
  outcome: "pay" | "decline"
): Promise<TestCheckoutResult> {
  const t = await getTranslations("donorDashboard.errors");
  if (outcome === "decline") return { ok: false, message: t("generic") };
  try {
    const found = await as(await currentActor()).payRecurringTestCheckout({
      id,
    });
    if (!found.ok) return { ok: false, message: t("generic") };
  } catch (error) {
    console.error("Monthly test checkout:", errorSummaryForLogs(error));
    return { ok: false, message: t("generic") };
  }
  redirect(recurringDonationPath(id));
}
