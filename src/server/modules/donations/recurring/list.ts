import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../../access/can";
import { donation, receipt, recurringDonation } from "../../../db/schema";
import type { UseCaseContext } from "../../../use-cases";

export async function listMyRecurringDonations(ctx: UseCaseContext) {
  await authorize(ctx, "recurring_donation.list_mine");
  if (ctx.actor.kind !== "user") throw new Error("No signed-in donor");
  return ctx.db
    .select()
    .from(recurringDonation)
    .where(eq(recurringDonation.userId, ctx.actor.userId))
    .orderBy(desc(recurringDonation.createdAt));
}

export async function getMyRecurringDonation(
  ctx: UseCaseContext,
  input: { id: string }
) {
  if (!z.uuid().safeParse(input.id).success || ctx.actor.kind !== "user")
    return { ok: false, error: "not_found" } as const;
  const [row] = await ctx.db
    .select()
    .from(recurringDonation)
    .where(eq(recurringDonation.id, input.id));
  if (!row || row.userId !== ctx.actor.userId)
    return { ok: false, error: "not_found" } as const;
  await authorize(ctx, "recurring_donation.read_own", { ownerId: row.userId });
  const charges = await ctx.db
    .select({
      id: donation.id,
      amountMinor: donation.amountMinor,
      capturedAt: donation.capturedAt,
      receiptId: receipt.id,
      receiptNumber: receipt.number,
    })
    .from(donation)
    .innerJoin(receipt, eq(receipt.donationId, donation.id))
    .where(eq(donation.recurringDonationId, row.id))
    .orderBy(desc(donation.capturedAt));
  return {
    ok: true,
    recurring: row,
    charges,
    checkout:
      ctx.payments.name === row.gateway
        ? ctx.payments.subscriptionCheckout({
            subscriptionId: row.gatewaySubscriptionId,
            description: "Monthly donation",
          })
        : null,
  } as const;
}

export async function listRecurringDonations(ctx: UseCaseContext) {
  await authorize(ctx, "recurring_donation.list");
  return ctx.db
    .select()
    .from(recurringDonation)
    .orderBy(desc(recurringDonation.createdAt));
}
