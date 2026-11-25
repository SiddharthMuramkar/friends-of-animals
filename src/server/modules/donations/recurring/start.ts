import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import {
  donor,
  gatewayPlan,
  recurringDonation,
  user,
} from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { invalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import { DONOR_PURPOSE, donorEmailHash } from "../donors";
import { defaultWallName } from "../domain/donor";
import { isKnownMinor } from "../minor";

const startInput = z.strictObject({
  amountMinor: z.bigint().positive(),
  showOnWall: z.boolean(),
  declaredAdult: z.boolean(),
  declaredIndianSource: z.boolean(),
});
export type StartRecurringDonationInput = z.input<typeof startInput>;

export async function startRecurringDonation(
  ctx: UseCaseContext,
  input: StartRecurringDonationInput
) {
  if (ctx.actor.kind !== "user")
    return { ok: false, error: "sign_in_required" } as const;
  const { role } = await authorize(ctx, "recurring_donation.start");
  const userId = ctx.actor.userId;
  const now = ctx.clock.now();
  if (
    !(await ctx.settings.get("donations.enabled")) ||
    !(await ctx.settings.get("donations.recurringEnabled"))
  )
    return { ok: false, error: "donations_closed" } as const;
  if (await isKnownMinor(ctx.db, ctx.cipher, userId, now))
    return { ok: false, error: "minor_must_ask_guardian" } as const;
  const parsed = startInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { amountMinor, showOnWall, declaredAdult, declaredIndianSource } =
    parsed.data;
  if (!declaredAdult || !declaredIndianSource)
    return { ok: false, error: "declaration_required" } as const;
  if (amountMinor < 10_000n)
    return { ok: false, error: "amount_too_small" } as const;
  if (amountMinor > 1_500_000n)
    return { ok: false, error: "amount_too_large" } as const;
  const [account] = await ctx.db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  if (!account?.email) return { ok: false, error: "email_required" } as const;
  const email = account.email;
  // A plan is shared for a gateway and amount. The unique key chooses one
  // winner if two starts race; an orphaned plan has no mandate or charges.
  const match = and(
    eq(gatewayPlan.gateway, ctx.payments.name),
    eq(gatewayPlan.amountMinor, amountMinor)
  );
  let [plan] = await ctx.db.select().from(gatewayPlan).where(match);
  if (!plan) {
    const made = await ctx.payments.createPlan({
      amountMinor,
      currency: "INR",
      period: "monthly",
      interval: 1,
      name: "FOA monthly donation",
    });
    await ctx.db
      .insert(gatewayPlan)
      .values({
        gateway: ctx.payments.name,
        amountMinor,
        gatewayPlanId: made.planId,
      })
      .onConflictDoNothing();
    [plan] = await ctx.db.select().from(gatewayPlan).where(match);
  }
  if (!plan) throw new Error("Recurring plan disappeared");
  const id = uuidv7(now);
  const donorId = uuidv7(now);
  const subscription = await ctx.payments.createSubscription({
    planId: plan.gatewayPlanId,
    totalCount: 120,
    customerNotify: false,
    notes: { recurringDonationId: id },
  });
  await ctx.db.transaction(async (tx) => {
    await tx.insert(donor).values({
      id: donorId,
      userId,
      type: "individual",
      name: ctx.cipher.encrypt(DONOR_PURPOSE.name, account.name),
      email: ctx.cipher.encrypt(DONOR_PURPOSE.email, email),
      emailHash: donorEmailHash(ctx.blindIndex, email),
      createdAt: now,
    });
    await tx.insert(recurringDonation).values({
      id,
      donorId,
      userId,
      amountMinor,
      status: "pending_authorisation",
      gateway: ctx.payments.name,
      gatewayPlanId: plan!.gatewayPlanId,
      gatewaySubscriptionId: subscription.id,
      showOnWall,
      wallName: showOnWall
        ? defaultWallName({
            type: "individual",
            name: account.name,
            discloseOrganisation: false,
          })
        : null,
      createdAt: now,
      updatedAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "recurring_donation.started",
      entity: { type: "recurring_donation", id },
      before: null,
      after: {
        status: "pending_authorisation",
        amountMinor: amountMinor.toString(),
      },
      actorRole: role,
    });
  });
  return {
    ok: true,
    id,
    status: "pending_authorisation",
    checkout: ctx.payments.subscriptionCheckout({
      subscriptionId: subscription.id,
      description: "Monthly donation",
    }),
  } as const;
}
