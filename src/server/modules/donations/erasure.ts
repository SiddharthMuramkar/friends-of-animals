// A donor's financial evidence stays intact (HR-31). Permission to announce
// their name and permission to debit future cycles are not financial evidence
// that needs to remain operational. Used by the approved privacy erasure.
import { count, inArray, or } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { donation, donor, receipt, recurringDonation } from "../../db/schema";
import {
  requestRecurringCancel,
  sendRecurringCancel,
} from "./recurring/cancel";
import {
  canCancelRecurring,
  isFinalRecurringStatus,
} from "./recurring/domain/recurring-status";
import type { SyncContext } from "./recurring/sync";

export async function donationErasureTargets(db: AppDb, users: string[]) {
  if (users.length === 0) {
    return { donorIds: [], mandateIds: [], liveMandateIds: [], records: 0 };
  }
  const donorIds = (
    await db
      .select({ id: donor.id })
      .from(donor)
      .where(inArray(donor.userId, users))
  ).map(({ id }) => id);
  const mandates = await db
    .select({ id: recurringDonation.id, status: recurringDonation.status })
    .from(recurringDonation)
    .where(
      or(
        inArray(recurringDonation.userId, users),
        inArray(recurringDonation.donorId, donorIds)
      )!
    )
    .orderBy(recurringDonation.id);
  const gifts = await db
    .select({ id: donation.id })
    .from(donation)
    .where(
      or(
        inArray(donation.donorId, donorIds),
        inArray(
          donation.recurringDonationId,
          mandates.map(({ id }) => id)
        )
      )!
    );
  const [receipts] = await db
    .select({ n: count() })
    .from(receipt)
    .where(
      inArray(
        receipt.donationId,
        gifts.map(({ id }) => id)
      )
    );
  return {
    donorIds,
    mandateIds: mandates.map(({ id }) => id),
    liveMandateIds: mandates
      .filter(({ status }) => canCancelRecurring(status))
      .map(({ id }) => id),
    records:
      donorIds.length + gifts.length + (receipts?.n ?? 0) + mandates.length,
  };
}

type DonationErasureTargets = Awaited<
  ReturnType<typeof donationErasureTargets>
>;

/** Optional publicity is withdrawn even if a legal hold keeps the identities
 * and accounting records. The receipt snapshots and ledger are not changed. */
export async function withdrawDonationRecognition(
  tx: AppDb,
  targets: DonationErasureTargets
) {
  await tx
    .update(recurringDonation)
    .set({ showOnWall: false, wallName: null })
    .where(inArray(recurringDonation.id, targets.mandateIds));
  await tx
    .update(donor)
    .set({ discloseOrganisation: false })
    .where(inArray(donor.id, targets.donorIds));
  await tx
    .update(donation)
    .set({ showOnWall: false, wallName: null })
    .where(
      or(
        inArray(donation.donorId, targets.donorIds),
        inArray(donation.recurringDonationId, targets.mandateIds)
      )!
    );
}

/** Durable cutoff first: concurrent or delayed charges are reconciled through
 * the ordinary recurring cancellation/refund path, not erased as data. */
export async function prepareDonationErasure(
  tx: AppDb,
  ctx: SyncContext,
  targets: DonationErasureTargets
): Promise<string[]> {
  const cancelling: string[] = [];
  for (const id of targets.liveMandateIds) {
    const row = await requestRecurringCancel(tx, ctx, id, "system");
    if (row && canCancelRecurring(row.status)) cancelling.push(id);
  }
  await withdrawDonationRecognition(tx, targets);
  return cancelling;
}

/** Never finish erasure while the provider's cancellation is unconfirmed. The
 * outbox's retries remain durable and the person's account is still present. */
export async function confirmDonationErasure(ctx: SyncContext, ids: string[]) {
  for (const id of ids) {
    const status = await sendRecurringCancel(ctx, id);
    if (!status || !isFinalRecurringStatus(status)) {
      throw new Error("Recurring donation cancellation not confirmed");
    }
  }
}
