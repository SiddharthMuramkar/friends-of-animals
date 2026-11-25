// A donation's checkout (#106), for whoever holds its checkout token: the
// donor who started it, signed in or not. A donation id alone opens
// nothing, and a wrong token reads as an unknown donation.
//
//   payForDonation          opens (or reuses) the gateway order for the
//                           donation's batch and hands back what Checkout
//                           needs; an open order is synced with the gateway
//                           first, since it may be paid with no signal in.
//   confirmDonationCheckout what Checkout handed back: the signature is
//                           checked against the order stored with the
//                           batch, then the batch is synced like a webhook
//                           (../payments/sync-batch.ts), so the two capture
//                           once between them.
//   payDonationTestCheckout the fallback gateway's test checkout (never
//                           production): pays or declines the order.
//
// No transaction stays open across a gateway call.

import { and, eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { z } from "zod";

import donationsMessages from "../../../../messages/en-IN/donations.json";
import { authorize } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import { hashLinkToken, isWellFormedLinkToken } from "../../crypto/link-token";
import type { AppDb } from "../../db/app-db";
import { donation, paymentBatch } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { CheckoutParams } from "../../ports/payment-gateway";
import { isFallbackGateway } from "../../ports/payment-gateway-fallback";
import type { UseCaseContext } from "../../use-cases";
import { lockBatch } from "../payments/batches";
import { nextPaymentBatchStatus } from "../payments/domain/batch-status";
import { syncBatch } from "../payments/sync-batch";
import {
  answerTestCheckout,
  type TestCheckoutAnswer,
} from "../payments/test-checkout";
import type { DonationStatus } from "./domain/donation-status";

const t = createTranslator({
  locale: "en-IN",
  messages: donationsMessages,
  namespace: "donations.gateway",
});

/** What every checkout use case is given: the donation and its bearer. */
const tokenInput = {
  donationId: z.uuid(),
  checkoutToken: z.string().min(1).max(100),
};

/**
 * The donation `checkoutToken` opens, or null for a wrong or malformed
 * token or an unknown donation, alike.
 */
export async function donationByToken(
  db: AppDb,
  donationId: string,
  checkoutToken: string
) {
  if (!isWellFormedLinkToken(checkoutToken)) return null;
  const [found] = await db
    .select({
      id: donation.id,
      status: donation.status,
      amountMinor: donation.amountMinor,
      batchId: donation.paymentBatchId,
      expiresAt: donation.expiresAt,
    })
    .from(donation)
    .where(
      and(
        eq(donation.id, donationId),
        eq(donation.checkoutTokenHash, hashLinkToken(checkoutToken))
      )
    );
  return found?.batchId ? { ...found, batchId: found.batchId } : null;
}

/** Statuses whose donation may still be paid at Checkout. */
const PAYABLE: readonly DonationStatus[] = ["pending", "failed"];

export type PayForDonationInput = { donationId: string; checkoutToken: string };

export type PayForDonationResult =
  /** Open `checkout` in the browser to pay batch `batchId`. */
  | { ok: true; kind: "checkout"; batchId: string; checkout: CheckoutParams }
  /** Nothing to pay: the donation is paid, refunded or expired. */
  | { ok: true; kind: "settled"; status: DonationStatus }
  | InvalidInput
  | { ok: false; error: "not_found" | "gateway_unavailable" | "superseded" };

const payInput = z.strictObject(tokenInput);

type Plan =
  | { kind: "done"; result: PayForDonationResult }
  | { kind: "check" }
  | { kind: "open" };

/** Plans tried before giving way to another request on the same order. */
const MAX_PLANS = 3;

export async function payForDonation(
  ctx: UseCaseContext,
  input: PayForDonationInput
): Promise<PayForDonationResult> {
  const { role } = await authorize(ctx, "donation.checkout");
  const parsed = payInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const found = await donationByToken(
    ctx.db,
    parsed.data.donationId,
    parsed.data.checkoutToken
  );
  if (!found) return { ok: false, error: "not_found" };

  let checked = false;
  for (let plans = 0; plans < MAX_PLANS; plans++) {
    const plan = await planCheckout(ctx, found, checked);
    if (plan.kind === "done") return plan.result;
    if (plan.kind === "open") return openOrder(ctx, found, role);
    try {
      await syncBatch(ctx, found.batchId, role);
    } catch (error) {
      ctx.errors.report(error, {
        where: "donations.syncBeforePay",
        tags: { gateway: ctx.payments.name },
        extra: { donationId: found.id },
      });
      return { ok: false, error: "gateway_unavailable" };
    }
    checked = true;
  }
  return { ok: false, error: "superseded" };
}

type Found = NonNullable<Awaited<ReturnType<typeof donationByToken>>>;

function checkoutFor(
  ctx: UseCaseContext,
  batchId: string,
  orderId: string,
  amountMinor: bigint
): PayForDonationResult {
  return {
    ok: true,
    kind: "checkout",
    batchId,
    checkout: ctx.payments.checkout({
      orderId,
      amount: { amountMinor, currency: "INR" },
      description: t("description"),
    }),
  };
}

async function planCheckout(
  ctx: UseCaseContext,
  found: Found,
  checked: boolean
): Promise<Plan> {
  return ctx.db.transaction(async (tx): Promise<Plan> => {
    const batch = await lockBatch(tx, found.batchId);
    const [now] = await tx
      .select({ status: donation.status })
      .from(donation)
      .where(eq(donation.id, found.id));
    if (!batch || !now) {
      return { kind: "done", result: { ok: false, error: "not_found" } };
    }
    if (!PAYABLE.includes(now.status)) {
      return {
        kind: "done",
        result: { ok: true, kind: "settled", status: now.status },
      };
    }
    if (batch.status === "created") return { kind: "open" };
    const askable =
      batch.status === "order_created" &&
      batch.gatewayOrderId !== null &&
      batch.gateway === ctx.payments.name;
    if (!askable) {
      // The order was made by another adapter, or the batch is in review.
      return {
        kind: "done",
        result: { ok: false, error: "gateway_unavailable" },
      };
    }
    if (!checked) return { kind: "check" };
    return {
      kind: "done",
      result: checkoutFor(
        ctx,
        batch.id,
        batch.gatewayOrderId!,
        batch.amountMinor
      ),
    };
  });
}

/**
 * Asks the gateway for the batch's order, outside any transaction, then
 * records it. A refused order changes nothing, so the donor may try again;
 * a batch another request opened meanwhile keeps that request's order.
 */
async function openOrder(
  ctx: UseCaseContext,
  found: Found,
  actorRole: Role | null
): Promise<PayForDonationResult> {
  const gateway = ctx.payments;
  let orderId: string;
  try {
    ({ orderId } = await gateway.createOrder({
      amount: { amountMinor: found.amountMinor, currency: "INR" },
      receipt: found.batchId,
      notes: { batchId: found.batchId, donationId: found.id },
    }));
  } catch (error) {
    ctx.errors.report(error, {
      where: "payments.createOrder",
      tags: { gateway: gateway.name },
      extra: { batchId: found.batchId },
    });
    return { ok: false, error: "gateway_unavailable" };
  }
  return ctx.db.transaction(async (tx): Promise<PayForDonationResult> => {
    const batch = await lockBatch(tx, found.batchId);
    if (!batch) return { ok: false, error: "not_found" };
    if (batch.status !== "created") {
      return batch.status === "order_created" && batch.gatewayOrderId
        ? checkoutFor(ctx, batch.id, batch.gatewayOrderId, batch.amountMinor)
        : { ok: false, error: "superseded" };
    }
    const move = nextPaymentBatchStatus(batch.status, "order_opened");
    if (!move.ok) return { ok: false, error: "superseded" };
    await tx
      .update(paymentBatch)
      .set({
        status: move.to,
        gatewayOrderId: orderId,
        updatedAt: ctx.clock.now(),
      })
      .where(eq(paymentBatch.id, batch.id));
    await recordAudit(tx, ctx, {
      action: "payment.batch_created",
      entity: { type: "payment_batch", id: batch.id },
      before: null,
      after: {
        status: move.to,
        purpose: "donation",
        donationId: found.id,
        amountMinor: batch.amountMinor.toString(),
        gatewayOrderId: orderId,
      },
      actorRole,
    });
    return checkoutFor(ctx, batch.id, orderId, batch.amountMinor);
  });
}

export type ConfirmDonationCheckoutInput = {
  donationId: string;
  checkoutToken: string;
  paymentId: string;
  signature: string;
};

export type ConfirmDonationCheckoutResult =
  | { ok: true; status: DonationStatus }
  | InvalidInput
  | { ok: false; error: "not_found" | "invalid_signature" };

const confirmInput = z.strictObject({
  ...tokenInput,
  paymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(200),
});

export async function confirmDonationCheckout(
  ctx: UseCaseContext,
  input: ConfirmDonationCheckoutInput
): Promise<ConfirmDonationCheckoutResult> {
  const { role } = await authorize(ctx, "donation.checkout");
  const parsed = confirmInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { donationId, checkoutToken, paymentId, signature } = parsed.data;
  const found = await donationByToken(ctx.db, donationId, checkoutToken);
  if (!found) return { ok: false, error: "not_found" };
  const [batch] = await ctx.db
    .select({
      gateway: paymentBatch.gateway,
      orderId: paymentBatch.gatewayOrderId,
    })
    .from(paymentBatch)
    .where(eq(paymentBatch.id, found.batchId));
  const genuine =
    batch?.orderId != null &&
    batch.gateway === ctx.payments.name &&
    ctx.payments.verifyCheckout({
      orderId: batch.orderId,
      paymentId,
      signature,
    });
  if (!genuine) return { ok: false, error: "invalid_signature" };
  await syncBatch(ctx, found.batchId, role);
  const [after] = await ctx.db
    .select({ status: donation.status })
    .from(donation)
    .where(eq(donation.id, found.id));
  return { ok: true, status: after?.status ?? found.status };
}

export type PayDonationTestCheckoutInput = {
  donationId: string;
  checkoutToken: string;
  outcome: "pay" | "decline";
};

export type PayDonationTestCheckoutResult =
  | TestCheckoutAnswer
  | InvalidInput
  | { ok: false; error: "unavailable" };

const testCheckoutInput = z.strictObject({
  ...tokenInput,
  outcome: z.enum(["pay", "decline"]),
});

export async function payDonationTestCheckout(
  ctx: UseCaseContext,
  input: PayDonationTestCheckoutInput
): Promise<PayDonationTestCheckoutResult> {
  await authorize(ctx, "donation.checkout");
  const parsed = testCheckoutInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const gateway = ctx.payments;
  if (!isFallbackGateway(gateway)) return { ok: false, error: "unavailable" };
  const found = await donationByToken(
    ctx.db,
    parsed.data.donationId,
    parsed.data.checkoutToken
  );
  if (!found) return { ok: false, error: "not_found" };
  const [batch] = await ctx.db
    .select({ orderId: paymentBatch.gatewayOrderId })
    .from(paymentBatch)
    .where(
      and(
        eq(paymentBatch.id, found.batchId),
        eq(paymentBatch.status, "order_created"),
        eq(paymentBatch.gateway, gateway.name)
      )
    );
  if (!batch?.orderId) return { ok: false, error: "not_found" };
  return answerTestCheckout(gateway, batch.orderId, parsed.data.outcome);
}
