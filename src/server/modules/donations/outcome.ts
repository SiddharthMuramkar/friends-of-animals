// getDonationOutcome({ donationId, checkoutToken }) (#106): what the
// thank-you page tells whoever holds the donation's checkout token. A
// donation still waiting for its payment is synced with the gateway once,
// so the page is right even before a webhook arrives (and on previews,
// which get none). The receipt itself is never shown here: it goes by its
// 7-day link, emailed to the donor.

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { paymentBatch, receipt, refund } from "../../db/schema";
import { donation } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { syncBatch } from "../payments/sync-batch";
import { donationByToken } from "./checkout";
import type { DonationStatus } from "./domain/donation-status";

export type GetDonationOutcomeInput = {
  donationId: string;
  checkoutToken: string;
};

export type DonationOutcome = {
  status: DonationStatus;
  amountMinor: bigint;
  /** Set once the donation is captured. */
  receiptNumber: string | null;
  receiptCancelled: boolean;
  /** Money from abroad was returned (FCRA off). */
  foreignRefund: boolean;
};

export type GetDonationOutcomeResult =
  | { ok: true; outcome: DonationOutcome }
  | InvalidInput
  | { ok: false; error: "not_found" };

const outcomeInput = z.strictObject({
  donationId: z.uuid(),
  checkoutToken: z.string().min(1).max(100),
});

export async function getDonationOutcome(
  ctx: UseCaseContext,
  input: GetDonationOutcomeInput
): Promise<GetDonationOutcomeResult> {
  const { role } = await authorize(ctx, "donation.checkout");
  const parsed = outcomeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const found = await donationByToken(
    ctx.db,
    parsed.data.donationId,
    parsed.data.checkoutToken
  );
  if (!found) return { ok: false, error: "not_found" };
  if (found.status === "pending" || found.status === "failed") {
    const [batch] = await ctx.db
      .select({
        status: paymentBatch.status,
        gateway: paymentBatch.gateway,
      })
      .from(paymentBatch)
      .where(eq(paymentBatch.id, found.batchId));
    if (
      batch?.status === "order_created" &&
      batch.gateway === ctx.payments.name
    ) {
      try {
        await syncBatch(ctx, found.batchId, role);
      } catch (error) {
        // The page still answers with what is known; a webhook catches up.
        ctx.errors.report(error, {
          where: "donations.syncForOutcome",
          tags: { gateway: ctx.payments.name },
          extra: { donationId: found.id },
        });
      }
    }
  }
  const [row] = await ctx.db
    .select({
      status: donation.status,
      amountMinor: donation.amountMinor,
      receiptNumber: receipt.number,
      receiptCancelledAt: receipt.cancelledAt,
    })
    .from(donation)
    .leftJoin(receipt, eq(receipt.donationId, donation.id))
    .where(eq(donation.id, found.id));
  if (!row) return { ok: false, error: "not_found" };
  const [foreign] = await ctx.db
    .select({ id: refund.id })
    .from(refund)
    .where(
      and(eq(refund.batchId, found.batchId), eq(refund.kind, "foreign_payment"))
    )
    .limit(1);
  return {
    ok: true,
    outcome: {
      status: row.status,
      amountMinor: row.amountMinor,
      receiptNumber: row.receiptNumber,
      receiptCancelled: row.receiptCancelledAt !== null,
      foreignRefund: foreign !== undefined,
    },
  };
}
