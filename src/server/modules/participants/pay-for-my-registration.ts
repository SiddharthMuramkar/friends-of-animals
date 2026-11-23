// payForMyRegistration({ registrationId }) (#78): an adult pays the fee for
// their own registration, or a guardian for their child's (#81), as a
// payment batch of one, on the payments
// module's machinery (#77): one batch holds the registration at the
// competition's individual fee (bigint paise), the gateway gets one order
// for it, and only the gateway's own record confirms it
// (../payments/sync-batch.ts), with a registration number.
//
// - A free competition (fee 0) confirms the registration at once, with no
//   batch and no order.
// - A minor's registration held until a guardian verifies (#81) can't be
//   paid for or confirmed, free or not: `awaiting_guardian`; nor one whose
//   guardian withdrew participation consent since it was released (#82):
//   `participation_consent_required`.
// - Paying again while the order is open returns the same order. Before
//   reusing or replacing an open order it is synced with the gateway first,
//   since it may have been paid with neither the Checkout return nor the
//   webhook in yet; while the gateway can't answer, nothing changes.
// - A fee that changed since the order opened (only before registration
//   opens, #72) cancels the old batch and opens a new one.
// - No transaction stays open across a gateway call.
//
// Somebody else's registration, or one that doesn't exist, is refused the
// same way, so nothing about another person leaks.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { z } from "zod";

import participantMessages from "../../../../messages/en-IN/participant.json";
import { authorize } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  participantProfile,
  paymentBatch,
  paymentBatchItem,
  registration,
  user,
} from "../../db/schema";
import { DomainError } from "../../errors";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { CheckoutParams, Money } from "../../ports/payment-gateway";
import type { UseCaseContext } from "../../use-cases";
import { getRegistrationTerms } from "../competitions/terms/read";
import {
  lockParticipationPins,
  participationRefusals,
} from "../consent/participation-gate";
import { guardianFlowsActive } from "../guardians/availability";
import { revokePendingGuardianRequest } from "../guardians/guardian-request";
import { ownProfileOf } from "../guardians/own-profile";
import {
  endUnpaidBatch,
  heldInReview,
  lockBatch,
  lockBatchAndParticipation,
} from "../payments/batches";
import { nextPaymentBatchStatus } from "../payments/domain/batch-status";
import { syncBatch } from "../payments/sync-batch";
import { confirmRegistrations } from "../registration/confirm";
import { canTransition } from "../registration/domain/registration-status";
import { paysFor } from "./owner";

export type PayForMyRegistrationInput = { registrationId: string };

export type PayForMyRegistrationResult =
  /** Open `checkout` in the browser to pay batch `batchId`. */
  | { ok: true; kind: "checkout"; batchId: string; checkout: CheckoutParams }
  /** The competition is free: confirmed now, with its number. */
  | { ok: true; kind: "confirmed_free"; registrationNumber: string }
  /** Already confirmed (paid, perhaps just found so by the sync). */
  | { ok: true; kind: "confirmed"; registrationNumber: string }
  | InvalidInput
  | {
      ok: false;
      error:
        | "nothing_to_pay"
        | "unavailable"
        | "awaiting_guardian"
        | "participation_consent_required"
        | "fee_not_set"
        | "gateway_unavailable"
        | "superseded";
    };

const payInput = z.object({ registrationId: z.uuid() });

const t = createTranslator({
  locale: "en-IN",
  messages: participantMessages,
  namespace: "participant.payment",
});

/**
 * Authorizes the actor as whoever pays for the registration: its adult
 * owner, or the child's verified guardian (./owner.ts).
 */
export async function authorizeOwner(
  ctx: UseCaseContext,
  registrationId: string
): Promise<Role | null> {
  const payer =
    ctx.actor.kind === "user" &&
    (await paysFor(ctx.db, registrationId, ctx.actor.userId));
  const { role } = await authorize(
    ctx,
    "registration.self.pay",
    payer && ctx.actor.kind === "user" ? { ownerId: ctx.actor.userId } : {}
  );
  return role;
}

type Plan =
  | { kind: "done"; result: PayForMyRegistrationResult }
  | { kind: "check"; batchId: string }
  | {
      kind: "open";
      batchId: string;
      total: Money;
      competitionName: string;
      participantCode: string;
    };

/** Plans tried before giving way to a payer who keeps replacing the batch. */
const MAX_PLANS = 3;

export async function payForMyRegistration(
  ctx: UseCaseContext,
  input: PayForMyRegistrationInput
): Promise<PayForMyRegistrationResult> {
  const parsed = payInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { registrationId } = parsed.data;
  const actorRole = await authorizeOwner(ctx, registrationId);

  let checked: string | null = null;
  for (let plans = 0; plans < MAX_PLANS; plans++) {
    const plan = await planPayment(ctx, registrationId, actorRole, checked);
    if (plan.kind === "done") return plan.result;
    if (plan.kind === "open") return openOrder(ctx, plan, actorRole);
    try {
      await syncBatch(ctx, plan.batchId, actorRole);
    } catch (error) {
      ctx.errors.report(error, {
        where: "participants.syncBeforePay",
        tags: { gateway: ctx.payments.name },
        extra: { batchId: plan.batchId },
      });
      return { ok: false, error: "gateway_unavailable" };
    }
    checked = plan.batchId;
  }
  return { ok: false, error: "superseded" };
}

/** The batch still waiting for its order or payment that holds it, if any. */
async function openBatchHolding(tx: AppDb, registrationId: string) {
  const [held] = await tx
    .select({ batchId: paymentBatchItem.batchId })
    .from(paymentBatchItem)
    .innerJoin(paymentBatch, eq(paymentBatch.id, paymentBatchItem.batchId))
    .where(
      and(
        eq(paymentBatchItem.registrationId, registrationId),
        isNull(paymentBatchItem.releasedAt),
        inArray(paymentBatch.status, ["created", "order_created"])
      )
    );
  return held ? lockBatch(tx, held.batchId) : null;
}

/**
 * In one transaction, with the registration locked: what is owed, and
 * whether the open batch is reused, replaced or checked first. An open
 * order is only reused or replaced once `checked` names it.
 */
async function planPayment(
  ctx: UseCaseContext,
  registrationId: string,
  actorRole: Role | null,
  checked: string | null
): Promise<Plan> {
  const now = ctx.clock.now();
  const gateway = ctx.payments;
  return ctx.db.transaction(async (tx): Promise<Plan> => {
    const done = (result: PayForMyRegistrationResult): Plan => ({
      kind: "done",
      result,
    });
    const actor = ctx.actor;
    if (actor.kind !== "user") throw new Error("unreachable");
    // Registration takes the competition lock before the payer's lock too.
    await lockParticipationPins(tx, [registrationId]);
    // Serialize the adult's claim with acceptance of their waiting request.
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, actor.userId))
      .for("no key update");
    const [mine] = await tx
      .select({
        status: registration.status,
        registrationNumber: registration.registrationNumber,
        profileId: participantProfile.id,
        ownerKind: participantProfile.ownerKind,
        competitionId: registration.competitionId,
        competitionCode: competition.code,
        competitionName: competition.name,
        participantCode: participantProfile.participantCode,
      })
      .from(registration)
      .innerJoin(competition, eq(competition.id, registration.competitionId))
      .innerJoin(
        participantProfile,
        eq(participantProfile.id, registration.participantProfileId)
      )
      .where(eq(registration.id, registrationId))
      .for("no key update", { of: registration });
    if (!mine) return done({ ok: false, error: "nothing_to_pay" });
    if (!(await paysFor(tx, registrationId, actor.userId))) {
      throw new DomainError("forbidden", "The registration payer changed");
    }
    if (mine.status === "confirmed" && mine.registrationNumber) {
      return done({
        ok: true,
        kind: "confirmed",
        registrationNumber: mine.registrationNumber,
      });
    }
    if (mine.status === "pending_guardian") {
      if (
        mine.ownerKind !== "self" ||
        (await ownProfileOf(tx, ctx, actor.userId, now)) !== "adult"
      ) {
        return done({
          ok: false,
          error: guardianFlowsActive(ctx.appEnv)
            ? "awaiting_guardian"
            : "unavailable",
        });
      }
      if (
        !canTransition("pending_guardian", "pending_payment", "participant")
      ) {
        throw new Error(
          "The registration machine no longer releases an adult's hold"
        );
      }
      await tx
        .update(registration)
        .set({ status: "pending_payment", updatedAt: now })
        .where(eq(registration.id, registrationId));
      await revokePendingGuardianRequest(tx, mine.profileId, now);
      await recordAudit(tx, ctx, {
        action: "registration.status_changed",
        entity: { type: "registration", id: registrationId },
        before: { status: "pending_guardian" },
        after: {
          status: "pending_payment",
          cause: "participant",
          reason: "turned_18",
        },
        actorRole,
      });
    } else if (mine.status !== "pending_payment") {
      return done({ ok: false, error: "nothing_to_pay" });
    }
    const refusal = (
      await participationRefusals(tx, ctx, [registrationId])
    ).get(registrationId);
    if (refusal) return done({ ok: false, error: refusal });
    // A payment for it is in review (#79): staff decide, nobody pays again.
    const [inReview] = await heldInReview(tx, registrationId);
    if (inReview) return done({ ok: false, error: "nothing_to_pay" });
    const fee = (await getRegistrationTerms(tx, mine.competitionId))?.fees
      .individual;
    if (!fee) return done({ ok: false, error: "fee_not_set" });

    const open = await openBatchHolding(tx, registrationId);
    if (open) {
      // Only the gateway that made the order can say whether it was paid.
      const askable =
        open.status === "order_created" &&
        open.gatewayOrderId !== null &&
        open.gateway === gateway.name;
      if (askable && open.id !== checked) {
        return { kind: "check", batchId: open.id };
      }
      if (askable && open.amountMinor === fee.amountMinor) {
        const total: Money = { amountMinor: open.amountMinor, currency: "INR" };
        return done({
          ok: true,
          kind: "checkout",
          batchId: open.id,
          checkout: gateway.checkout({
            orderId: open.gatewayOrderId!,
            amount: total,
            description: describe(mine.competitionName, mine.participantCode),
          }),
        });
      }
      await endUnpaidBatch(tx, ctx, open, "superseded", actorRole);
    }

    if (fee.amountMinor === 0n) {
      const { confirmed, error } = await confirmRegistrations(tx, ctx, {
        registrationIds: [registrationId],
        competitionCode: mine.competitionCode,
        batchId: null,
        actorRole,
      });
      if (error) return done({ ok: false, error });
      const [number] = confirmed;
      if (!number)
        throw new Error(`Registration ${registrationId} not confirmed`);
      return done({
        ok: true,
        kind: "confirmed_free",
        registrationNumber: number.registrationNumber,
      });
    }

    const batchId = uuidv7(now);
    await tx.insert(paymentBatch).values({
      id: batchId,
      route: "individual",
      competitionId: mine.competitionId,
      institutionId: null,
      institutionRegistrationId: null,
      payerUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      status: "created",
      amountMinor: fee.amountMinor,
      currency: fee.currency,
      gateway: gateway.name,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(paymentBatchItem).values({
      batchId,
      registrationId,
      amountMinor: fee.amountMinor,
    });
    return {
      kind: "open",
      batchId,
      total: { amountMinor: fee.amountMinor, currency: "INR" },
      competitionName: mine.competitionName,
      participantCode: mine.participantCode ?? "",
    };
  });
}

/**
 * Asks the gateway for the new batch's order, outside any transaction,
 * then records it; a refused order fails the batch and lets the
 * registration go.
 */
async function openOrder(
  ctx: UseCaseContext,
  plan: Extract<Plan, { kind: "open" }>,
  actorRole: Role | null
): Promise<PayForMyRegistrationResult> {
  const gateway = ctx.payments;
  const { batchId, total } = plan;
  let orderId: string;
  try {
    ({ orderId } = await gateway.createOrder({
      amount: total,
      receipt: batchId,
      notes: { batchId, participantCode: plan.participantCode },
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

  return ctx.db.transaction(async (tx): Promise<PayForMyRegistrationResult> => {
    const batch = await lockBatchAndParticipation(tx, batchId);
    if (!batch) return { ok: false, error: "superseded" };
    const move = nextPaymentBatchStatus(batch.status, "order_opened");
    if (!move.ok) return { ok: false, error: "superseded" };
    await tx
      .update(paymentBatch)
      .set({
        status: move.to,
        gatewayOrderId: orderId,
        updatedAt: ctx.clock.now(),
      })
      .where(eq(paymentBatch.id, batchId));
    const [item] = await tx
      .select({ registrationId: paymentBatchItem.registrationId })
      .from(paymentBatchItem)
      .where(eq(paymentBatchItem.batchId, batchId));
    const registrationIds = item ? [item.registrationId] : [];
    await recordAudit(tx, ctx, {
      action: "payment.batch_created",
      entity: { type: "payment_batch", id: batchId },
      before: null,
      after: {
        status: move.to,
        route: "individual",
        amountMinor: total.amountMinor.toString(),
        registrationIds,
        gatewayOrderId: orderId,
      },
      actorRole,
    });
    // Consent can change while the gateway is opening the order. Keep the
    // reference for reconciliation and only return a checkout with consent.
    const [refusal] = (
      await participationRefusals(tx, ctx, registrationIds)
    ).values();
    if (refusal) return { ok: false, error: refusal };
    return {
      ok: true,
      kind: "checkout",
      batchId,
      checkout: gateway.checkout({
        orderId,
        amount: total,
        description: describe(plan.competitionName, plan.participantCode),
      }),
    };
  });
}

/** What the payer sees on the gateway's checkout. */
function describe(competitionName: string, participantCode: string | null) {
  return t("checkoutDescription", {
    competition: competitionName,
    participantCode: participantCode ?? "",
  });
}
