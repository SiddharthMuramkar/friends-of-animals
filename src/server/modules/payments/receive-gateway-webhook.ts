// receiveGatewayWebhook({ rawBody, headers }) (#77): what the webhook route
// (77b) hands over, exactly as it arrived. It runs as a visitor: the
// signature over the raw body is the only thing that authorises it, so a
// webhook whose signature is missing or wrong is rejected and leaves no
// trace.
//
// A genuine webhook is stored by its event id (never its body, which
// carries the payer's email and phone), so a replay is answered as a
// duplicate and changes nothing. One about an order of ours syncs its
// batch against the gateway's record (./sync-batch.ts), whatever event it
// is: the webhook is only a hint. A refund event (#80) syncs our refunds
// of that payment instead (./refunds/sync-refund.ts). The stored row keeps
// what it led to.

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { gatewayWebhookEvent, paymentBatch } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import type { WebhookOutcome } from "./domain/outcomes";
import { syncRefundsOfPayment } from "./refunds/sync-refund";
import { syncRecurringDonation } from "../donations/recurring/sync";
import { syncBatch } from "./sync-batch";

export type ReceiveGatewayWebhookInput = { rawBody: string; headers: Headers };

export type ReceiveGatewayWebhookResult =
  | { ok: true; outcome: WebhookOutcome | "duplicate" }
  | InvalidInput
  | { ok: false; error: "rejected" };

const webhookInput = z.object({
  // Razorpay's events are a few kilobytes; anything near this is not one.
  rawBody: z.string().max(1_000_000),
  headers: z.instanceof(Headers),
});

export async function receiveGatewayWebhook(
  ctx: UseCaseContext,
  input: ReceiveGatewayWebhookInput
): Promise<ReceiveGatewayWebhookResult> {
  const parsed = webhookInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  await authorize(ctx, "payments.gateway_signal");
  const gateway = ctx.payments;
  const event = gateway.readWebhook(parsed.data.rawBody, parsed.data.headers);
  if (!event) return { ok: false, error: "rejected" };

  const now = ctx.clock.now();
  const [stored] = await ctx.db
    .insert(gatewayWebhookEvent)
    .values({
      id: uuidv7(now),
      gateway: gateway.name,
      eventId: event.eventId,
      type: event.type,
      orderId: event.orderId,
      receivedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: gatewayWebhookEvent.id });
  let rowId = stored?.id;
  if (!rowId) {
    const [earlier] = await ctx.db
      .select({
        id: gatewayWebhookEvent.id,
        outcome: gatewayWebhookEvent.outcome,
      })
      .from(gatewayWebhookEvent)
      .where(
        and(
          eq(gatewayWebhookEvent.gateway, gateway.name),
          eq(gatewayWebhookEvent.eventId, event.eventId)
        )
      );
    if (!earlier || earlier.outcome !== null) {
      return { ok: true, outcome: "duplicate" };
    }
    // An earlier delivery stopped before it finished: handle it again.
    rowId = earlier.id;
  }

  if (event.refund) {
    const synced = await syncRefundsOfPayment(ctx, event.refund);
    await ctx.db
      .update(gatewayWebhookEvent)
      .set({
        outcome: synced ? "refund_updated" : "ignored",
        processedAt: ctx.clock.now(),
      })
      .where(
        and(
          eq(gatewayWebhookEvent.id, rowId),
          isNull(gatewayWebhookEvent.outcome)
        )
      );
    return { ok: true, outcome: synced ? "refund_updated" : "ignored" };
  }

  const [batch] = event.orderId
    ? await ctx.db
        .select({ id: paymentBatch.id })
        .from(paymentBatch)
        .where(
          and(
            eq(paymentBatch.gateway, gateway.name),
            eq(paymentBatch.gatewayOrderId, event.orderId)
          )
        )
    : [];
  const outcome: WebhookOutcome = event.subscriptionId
    ? (await syncRecurringDonation(ctx, event.subscriptionId))
      ? "already_captured"
      : "ignored"
    : batch
      ? await syncBatch(ctx, batch.id, null)
      : "ignored";
  await ctx.db
    .update(gatewayWebhookEvent)
    .set({ outcome, processedAt: ctx.clock.now() })
    .where(
      and(
        eq(gatewayWebhookEvent.id, rowId),
        isNull(gatewayWebhookEvent.outcome)
      )
    );
  return { ok: true, outcome };
}
