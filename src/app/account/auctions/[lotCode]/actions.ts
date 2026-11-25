"use server";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { as, currentActor } from "@/server/app";
import {
  checkoutReturnFrom,
  checkoutView,
  type CheckoutReturn,
  type PayView,
  type TestCheckoutResult,
} from "@/components/payments/pay-view";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { parseLotCode } from "@/server/modules/auctions/domain/lot-code";
const path = (code: string) => `/account/auctions/${parseLotCode(code) ?? ""}`;
async function message() {
  return (await getTranslations("auctions.purchase"))("paymentError");
}
export async function startAuctionCheckout(offerId: string): Promise<PayView> {
  try {
    const result = await as(await currentActor()).openAuctionCheckout({
      offerId,
    });
    if (result.ok)
      return {
        kind: "checkout",
        batchId: result.batchId,
        checkout: checkoutView(
          result.checkout,
          formatPaise(result.checkout.amount.amountMinor)
        ),
      };
  } catch {
    /* payment status remains server-controlled */
  }
  return { kind: "error", message: await message() };
}
export async function confirmAuctionCheckout(
  code: string,
  offerId: string,
  _batchId: string,
  answer: CheckoutReturn
): Promise<PayView> {
  const paid = checkoutReturnFrom(answer);
  if (!paid) return { kind: "error", message: await message() };
  try {
    const result = await as(await currentActor()).confirmAuctionCheckout({
      offerId,
      ...paid,
    });
    if (!result.ok) return { kind: "error", message: await message() };
  } catch {
    return { kind: "error", message: await message() };
  }
  redirect(path(code));
}
export async function answerAuctionCheckout(
  offerId: string,
  _batchId: string,
  outcome: "pay" | "decline"
): Promise<TestCheckoutResult> {
  try {
    const result = await as(await currentActor()).payAuctionTestCheckout({
      offerId,
      outcome,
    });
    if (result.ok && result.outcome === "paid")
      return {
        ok: true,
        paymentId: result.paymentId,
        signature: result.signature,
      };
  } catch {
    /* Return translated error */
  }
  return { ok: false, message: await message() };
}
const read = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};
export async function saveAuctionAddress(
  code: string,
  offerId: string,
  form: FormData
) {
  const result = await as(await currentActor()).saveAuctionAddress({
    offerId,
    address: {
      recipientName: read(form, "recipientName"),
      line1: read(form, "line1"),
      line2: read(form, "line2"),
      city: read(form, "city"),
      state: read(form, "state"),
      pincode: read(form, "pincode"),
    },
  });
  redirect(path(code) + `?result=${result.ok ? "ok" : "error"}`);
}
export async function confirmAuctionReceipt(code: string, offerId: string) {
  const result = await as(await currentActor()).confirmAuctionReceipt({
    offerId,
  });
  redirect(path(code) + `?result=${result.ok ? "ok" : "error"}`);
}
