// Read only donations whose ledger movements belong to the selected
// published months. Choices are stored for each gift: one donor's refusal
// is never overridden by another gift from the same organisation.

import { and, eq, inArray, isNotNull, ne, or, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { AppDb } from "../../db/app-db";
import {
  donation,
  donor,
  ledgerAccount,
  ledgerLine,
  ledgerPosting,
} from "../../db/schema";
import { SYSTEM_ACCOUNT_CODES } from "../ledger/domain/chart";

export const donationCodes = [
  SYSTEM_ACCOUNT_CODES.individualDonations,
  SYSTEM_ACCOUNT_CODES.corporateDonations,
  SYSTEM_ACCOUNT_CODES.csrDonations,
];

export async function recognition(tx: AppDb, months: string[]) {
  const original = alias(ledgerPosting, "original_posting");
  const name = sql<
    string | null
  >`case when ${donor.type} = 'individual' then ${donation.wallName} else ${donor.organisationName} end`;
  const movements = await tx
    .select({
      type: donor.type,
      name,
      debitMinor: sum(ledgerLine.debitMinor),
      creditMinor: sum(ledgerLine.creditMinor),
    })
    .from(ledgerPosting)
    .leftJoin(original, eq(original.id, ledgerPosting.reversalOfPostingId))
    .innerJoin(
      donation,
      or(
        and(
          eq(ledgerPosting.sourceType, "donation"),
          eq(ledgerPosting.sourceId, sql<string>`${donation.id}::text`)
        ),
        and(
          eq(ledgerPosting.sourceType, "refund"),
          eq(original.sourceType, "donation"),
          eq(original.sourceId, sql<string>`${donation.id}::text`)
        )
      )
    )
    .innerJoin(donor, eq(donor.id, donation.donorId))
    .innerJoin(ledgerLine, eq(ledgerLine.postingId, ledgerPosting.id))
    .innerJoin(ledgerAccount, eq(ledgerAccount.id, ledgerLine.accountId))
    .where(
      and(
        inArray(ledgerPosting.periodMonth, months),
        inArray(ledgerAccount.code, donationCodes),
        or(
          and(
            eq(donor.type, "individual"),
            eq(donation.showOnWall, true),
            isNotNull(donation.wallName)
          ),
          and(
            ne(donor.type, "individual"),
            eq(donor.discloseOrganisation, true),
            isNotNull(donor.organisationName)
          )
        )
      )
    )
    .groupBy(donation.id, donor.id);

  const supporters = new Set<string>();
  const totals = new Map<string, bigint>();
  for (const row of movements) {
    const publicName = row.name?.trim();
    if (!publicName) continue;
    const net = BigInt(row.creditMinor ?? 0) - BigInt(row.debitMinor ?? 0);
    if (row.type === "individual") {
      if (net > 0n) supporters.add(publicName);
    } else {
      totals.set(publicName, (totals.get(publicName) ?? 0n) + net);
    }
  }
  return {
    supporters: [...supporters].sort((a, b) => a.localeCompare(b, "en-IN")),
    organisations: [...totals]
      // A fully returned gift is no longer recognised as support.
      .filter(([, totalMinor]) => totalMinor > 0n)
      .map(([name, totalMinor]) => ({ name, totalMinor }))
      .sort((a, b) =>
        a.totalMinor === b.totalMinor
          ? a.name.localeCompare(b.name, "en-IN")
          : a.totalMinor > b.totalMinor
            ? -1
            : 1
      ),
  };
}
