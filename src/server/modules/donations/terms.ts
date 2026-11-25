// getDonationTerms() (#106): what the donate page needs to know before
// anyone gives: whether online giving is open, whether a guest may give,
// and the amounts allowed. Public: the page shows them to everyone.

import { authorize } from "../../access/can";
import type { UseCaseContext } from "../../use-cases";

export type DonationTerms = {
  open: boolean;
  recurringEnabled: boolean;
  guestsAllowed: boolean;
  minAmountMinor: bigint;
  maxAmountMinor: bigint;
};

/** What the page shows while the terms can't be read: closed. */
export const CLOSED_TERMS: DonationTerms = {
  open: false,
  recurringEnabled: false,
  guestsAllowed: false,
  minAmountMinor: 10_000n,
  maxAmountMinor: 10_000_000n,
};

/** The cache tag of the donate page's read of the terms. */
export const DONATION_TERMS_TAG = "donations:terms";

/** The cached reads to refresh when the setting `key` changes. */
export function donationTagsForSetting(key: string): string[] {
  return key.startsWith("donations.") ? [DONATION_TERMS_TAG] : [];
}

export async function getDonationTerms(
  ctx: UseCaseContext
): Promise<DonationTerms> {
  await authorize(ctx, "donation.start");
  const [open, recurringEnabled, guestsAllowed, minRupees, maxRupees] =
    await Promise.all([
      ctx.settings.get("donations.enabled"),
      ctx.settings.get("donations.recurringEnabled"),
      ctx.settings.get("donations.allowGuest"),
      ctx.settings.get("donations.minAmountRupees"),
      ctx.settings.get("donations.maxAmountRupees"),
    ]);
  return {
    open,
    recurringEnabled,
    guestsAllowed,
    minAmountMinor: BigInt(minRupees) * 100n,
    maxAmountMinor: BigInt(Math.max(minRupees, maxRupees)) * 100n,
  };
}
