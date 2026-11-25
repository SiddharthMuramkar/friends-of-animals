import { eq } from "drizzle-orm";
import {
  donation,
  donor,
  gatewayPlan,
  gatewayTestPlan,
  gatewayTestOrder,
  gatewayTestPayment,
  gatewayTestSubscription,
  paymentBatch,
  recurringDonation,
} from "../db/schema";
import { DONOR_PURPOSE, donorEmailHash } from "../modules/donations/donors";
import { issueReceipt } from "../modules/donations/receipts/issue";
import { SEED_ACCOUNTS } from "./accounts";
import type { SeedDeps } from "./types";

const id = (suffix: number) =>
  `01938a00-0000-7000-8000-000000107${String(suffix).padStart(3, "0")}`;
export const SEED_RECURRING_DONATIONS = [id(1), id(2), id(3)] as const;
export const SEED_RECURRING_CHARGES = [id(31), id(32)] as const;

export async function seedRecurringDonations(deps: SeedDeps) {
  const now = deps.clock.now();
  const [already] = await deps.db
    .select({ id: recurringDonation.id })
    .from(recurringDonation)
    .where(eq(recurringDonation.id, SEED_RECURRING_DONATIONS[0]));
  if (already) return;
  const planId = "plan_fallback_seed_monthly";
  const amountMinor = 100_000n;
  await deps.db.transaction(async (tx) => {
    await tx
      .insert(gatewayTestPlan)
      .values({ id: planId, amountMinor })
      .onConflictDoNothing();
    await tx
      .insert(gatewayPlan)
      .values({ gateway: "fallback", gatewayPlanId: planId, amountMinor })
      .onConflictDoNothing();
    const [plan] = await tx
      .select()
      .from(gatewayPlan)
      .where(eq(gatewayPlan.gatewayPlanId, planId));
    if (!plan) throw new Error("Seed recurring plan is missing");
    for (const [index, status] of (
      ["active", "past_due", "cancelled"] as const
    ).entries()) {
      const account = SEED_ACCOUNTS.members[index]!;
      const donorId = id(11 + index);
      const recurringId = SEED_RECURRING_DONATIONS[index]!;
      const subId = `sub_fallback_seed_${index}`;
      const createdAt = new Date(now.getTime() - 62 * 86400000);
      const nextChargeAt =
        status === "cancelled" ? null : new Date(now.getTime() + 5 * 86400000);
      await tx.insert(donor).values({
        id: donorId,
        userId: account.id,
        type: "individual",
        name: deps.cipher.encrypt(DONOR_PURPOSE.name, account.name),
        email: deps.cipher.encrypt(DONOR_PURPOSE.email, account.email),
        emailHash: donorEmailHash(deps.blindIndex, account.email),
        createdAt,
      });
      await tx.insert(gatewayTestOrder).values({
        id: subId,
        receipt: recurringId,
        amountMinor,
        currency: "INR",
        createdAt,
      });
      await tx.insert(gatewayTestSubscription).values({
        id: subId,
        planId,
        status: status === "past_due" ? "pending" : status,
        currentStart: now,
        chargeAt: nextChargeAt,
        endedAt: status === "cancelled" ? now : null,
        notes: { recurringDonationId: recurringId },
      });
      await tx.insert(recurringDonation).values({
        id: recurringId,
        donorId,
        userId: account.id,
        amountMinor,
        gateway: "fallback",
        gatewayPlanId: planId,
        gatewaySubscriptionId: subId,
        status,
        nextChargeAt,
        showOnWall: false,
        wallName: null,
        createdAt,
        updatedAt: now,
        ...(status === "cancelled"
          ? {
              cancelRequestedAt: now,
              cancelRequestedBy: "donor" as const,
              cancelledAt: now,
              cancelledBy: "donor" as const,
            }
          : {}),
      });
      if (status !== "active") continue;
      for (const [
        chargeIndex,
        donationId,
      ] of SEED_RECURRING_CHARGES.entries()) {
        // Use the current capture instant for numbering in the seeded FY.
        const batchId = id(41 + chargeIndex);
        const paymentId = `pay_fallback_seed_recurring_${chargeIndex}`;
        await tx.insert(gatewayTestPayment).values({
          id: paymentId,
          orderId: subId,
          status: "captured",
          amountMinor,
          currency: "INR",
          createdAt: now,
        });
        await tx.insert(paymentBatch).values({
          id: batchId,
          purpose: "donation",
          status: "captured",
          amountMinor,
          currency: "INR",
          payerUserId: account.id,
          gateway: "fallback",
          gatewayOrderId: `subscription-charge:${paymentId}`,
          gatewayPaymentId: paymentId,
          captureMethod: "gateway",
          createdAt: now,
          updatedAt: now,
          capturedAt: now,
        });
        await tx.insert(donation).values({
          id: donationId,
          donorId,
          recurringDonationId: recurringId,
          origin: "recurring_charge",
          status: "captured",
          amountMinor,
          currency: "INR",
          gatewayPaymentId: paymentId,
          showOnWall: false,
          declaredAdult: true,
          declaredIndianSource: true,
          paymentBatchId: batchId,
          capturedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await issueReceipt(tx, deps, {
          donationId,
          donorId,
          amountMinor,
          gatewayPaymentId: paymentId,
          issuedAt: now,
        });
      }
    }
  });
}
