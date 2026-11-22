// payInstitutionFees({ institutionId, reference }) (#77): a coordinator, or
// the institution's authorised person, pays every unpaid student's fee in
// one go. One payment batch holds the registrations, with the fee each is
// charged, and the gateway gets one order for their sum (bigint paise),
// with the batch id as its receipt. The browser then opens the returned
// checkout; the money is only trusted once the gateway's own record says
// so (./sync-batch.ts).
//
// - A free competition (fee 0) confirms the registrations at once, with
//   no batch and no order.
// - Paying again over the same students reuses the open order. A changed
//   set (a student added or withdrawn) cancels the old batch, lets its
//   students go and opens a new one.
// - No transaction stays open across the gateway call: the batch is saved
//   (`created`), the order is asked for, then the order id is saved
//   (`order_created`), or the batch fails and lets its students go.

import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { z } from "zod";

import registrationMessages from "../../../../messages/en-IN/registration.json";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { paymentBatch, paymentBatchItem } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { CheckoutParams, Money } from "../../ports/payment-gateway";
import type { UseCaseContext } from "../../use-cases";
import { getRegistrationTerms } from "../competitions/terms/read";
import { institutionResource } from "../institutions/coordinators/policy";
import { confirmRegistrations } from "../registration/confirm";
import { loadEnrolmentFacts } from "../registration/enrolment-facts";
import {
  endUnpaidBatch,
  heldItems,
  lockBatch,
  openBatchOf,
  payableRegistrations,
} from "./batches";
import { batchTotal } from "./domain/batch-amount";
import { nextPaymentBatchStatus } from "./domain/batch-status";

export type PayInstitutionFeesInput = {
  institutionId: string;
  reference: string;
};

export type PayInstitutionFeesResult =
  /** Open `checkout` in the browser to pay batch `batchId`. */
  | { ok: true; kind: "checkout"; batchId: string; checkout: CheckoutParams }
  /** The competition is free: `confirmed` registrations are confirmed. */
  | { ok: true; kind: "confirmed_free"; confirmed: number }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | "institution_not_verified"
        | "nothing_to_pay"
        | "fee_not_set"
        | "gateway_unavailable"
        | "superseded";
    };

const payInput = z.object({
  institutionId: z.uuid(),
  reference: z.string().max(40),
});

const t = createTranslator({
  locale: "en-IN",
  messages: registrationMessages,
  namespace: "registration.payment",
});

/** What tx1 decided: an answer now, an order to reuse, or one to open. */
type Plan =
  | { kind: "done"; result: PayInstitutionFeesResult }
  | {
      kind: "open";
      batchId: string;
      total: Money;
      count: number;
      reference: string;
      competitionName: string;
      actorRole: Awaited<ReturnType<typeof authorize>>["role"];
    };

export async function payInstitutionFees(
  ctx: UseCaseContext,
  input: PayInstitutionFeesInput
): Promise<PayInstitutionFeesResult> {
  const parsed = payInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, reference } = parsed.data;
  const resource = institutionResource(institutionId);
  await authorize(ctx, "payments.pay", resource);
  const now = ctx.clock.now();
  const gateway = ctx.payments;

  const plan = await ctx.db.transaction(async (tx): Promise<Plan> => {
    const done = (result: PayInstitutionFeesResult): Plan => ({
      kind: "done",
      result,
    });
    // Locks the institution registration, so payers and enrolments in it
    // take turns.
    const facts = await loadEnrolmentFacts(
      tx,
      { institutionId, reference },
      now,
      { lock: true }
    );
    const { role: actorRole } = await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "payments.pay",
      resource
    );
    if (!facts) return done({ ok: false, error: "not_found" });
    if (facts.enrolment === "institution_not_verified") {
      return done({ ok: false, error: "institution_not_verified" });
    }
    const registered = facts.institutionRegistration;
    const payable = await payableRegistrations(tx, registered.id);
    if (payable.length === 0)
      return done({ ok: false, error: "nothing_to_pay" });
    const fee = (await getRegistrationTerms(tx, registered.competitionId))?.fees
      .institution;
    if (!fee) return done({ ok: false, error: "fee_not_set" });

    const open = await openBatchOf(tx, registered.id);
    if (open) {
      const held = await heldItems(tx, open.id);
      const sameOrder =
        open.status === "order_created" &&
        open.gatewayOrderId !== null &&
        open.gateway === gateway.name &&
        fee.amountMinor > 0n &&
        held.length === payable.length &&
        held.every(
          (item, at) =>
            item.registrationId === payable[at] &&
            item.amountMinor === fee.amountMinor
        );
      if (sameOrder) {
        const total: Money = { amountMinor: open.amountMinor, currency: "INR" };
        return done({
          ok: true,
          kind: "checkout",
          batchId: open.id,
          checkout: gateway.checkout({
            orderId: open.gatewayOrderId!,
            amount: total,
            description: describe(
              payable.length,
              facts.competition.name,
              registered.reference
            ),
          }),
        });
      }
      await endUnpaidBatch(tx, ctx, open, "superseded", actorRole);
    }

    if (fee.amountMinor === 0n) {
      const { confirmed } = await confirmRegistrations(tx, ctx, {
        registrationIds: payable,
        competitionCode: facts.competition.code,
        batchId: null,
        actorRole,
      });
      return done({
        ok: true,
        kind: "confirmed_free",
        confirmed: confirmed.length,
      });
    }

    const totalOf = batchTotal(payable.map(() => fee));
    if (!totalOf.ok) throw new Error(`Batch total refused: ${totalOf.reason}`);
    const batchId = uuidv7(now);
    await tx.insert(paymentBatch).values({
      id: batchId,
      route: "institution",
      competitionId: registered.competitionId,
      institutionId,
      institutionRegistrationId: registered.id,
      payerUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      status: "created",
      amountMinor: totalOf.total.amountMinor,
      currency: totalOf.total.currency,
      gateway: gateway.name,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(paymentBatchItem).values(
      payable.map((registrationId) => ({
        batchId,
        registrationId,
        amountMinor: fee.amountMinor,
      }))
    );
    return {
      kind: "open",
      batchId,
      total: totalOf.total,
      count: payable.length,
      reference: registered.reference,
      competitionName: facts.competition.name,
      actorRole,
    };
  });
  if (plan.kind === "done") return plan.result;

  const { batchId, total, actorRole } = plan;
  let orderId: string;
  try {
    ({ orderId } = await gateway.createOrder({
      amount: total,
      receipt: batchId,
      notes: { batchId, reference: plan.reference },
    }));
  } catch (error) {
    ctx.errors.report(error, {
      where: "payments.createOrder",
      tags: { gateway: gateway.name },
      extra: { batchId },
    });
    await ctx.db.transaction(async (tx) => {
      const batch = await lockBatch(tx, batchId);
      if (batch) {
        await endUnpaidBatch(tx, ctx, batch, "order_refused", actorRole);
      }
    });
    return { ok: false, error: "gateway_unavailable" };
  }

  const opened = await ctx.db.transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    // Replaced by another payer's batch while the order was being made.
    if (!batch) return false;
    const move = nextPaymentBatchStatus(batch.status, "order_opened");
    if (!move.ok) return false;
    const updatedAt = ctx.clock.now();
    await tx
      .update(paymentBatch)
      .set({ status: move.to, gatewayOrderId: orderId, updatedAt })
      .where(eq(paymentBatch.id, batchId));
    const held = await heldItems(tx, batchId);
    await recordAudit(tx, ctx, {
      action: "payment.batch_created",
      entity: { type: "payment_batch", id: batchId },
      before: null,
      after: {
        status: move.to,
        amountMinor: total.amountMinor.toString(),
        registrationIds: held.map((item) => item.registrationId),
        gatewayOrderId: orderId,
      },
      actorRole,
    });
    return true;
  });
  if (!opened) return { ok: false, error: "superseded" };

  return {
    ok: true,
    kind: "checkout",
    batchId,
    checkout: gateway.checkout({
      orderId,
      amount: total,
      description: describe(plan.count, plan.competitionName, plan.reference),
    }),
  };
}

/** What the payer sees on the gateway's checkout. */
function describe(
  count: number,
  competition: string,
  reference: string
): string {
  return t("checkoutDescription", { count, competition, reference });
}
