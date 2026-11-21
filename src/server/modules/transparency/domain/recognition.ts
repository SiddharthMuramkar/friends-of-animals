// The people half of the transparency page (#110): who is thanked by name.
// Organisations that chose disclosure are listed with their totals for the
// financial year; individuals who opted in to the donor wall appear by their
// wall name only, never with an amount. Nobody else is named, and the output
// holds names and organisation totals only: no ids, emails, types or dates.
//
// Money counts only from published (locked) months, net of refunds, so a
// name never appears before its month is published. Choices go the other
// way: each donor's latest choice decides whether they are named, even when
// it was made in a month not yet published, because hiding reveals nothing.
// An organisation's total adds only the donations it agreed to disclose.
// Pure; no imports beyond the period helpers.

import {
  monthsOfFinancialYear,
  type FinancialYear,
  type PeriodMonth,
} from "./financial-year";

export type DonorType = "individual" | "corporate" | "csr";

/** What a donor chose when giving one donation. */
export type DonationChoice = {
  donationId: string;
  donorId: string;
  donorType: DonorType;
  capturedAt: Date;
  showOnWall: boolean;
  wallName: string | null;
  /** Required for organisations; null for individuals. */
  discloseOrganisation: boolean | null;
  organisationName: string | null;
};

/**
 * One ledger movement of a donation's money on the donation income
 * accounts: positive when captured, negative when refunded, filed under the
 * period month of its posting.
 */
export type DonationLeg = {
  donationId: string;
  month: PeriodMonth;
  amountMinor: bigint;
};

export type Recognition = {
  /** Disclosed organisations, largest total first. */
  organisations: { name: string; totalMinor: bigint }[];
  /** Opted-in individuals' wall names, each once, in name order. */
  supporters: string[];
};

function isLater(a: DonationChoice, b: DonationChoice): boolean {
  const diff = a.capturedAt.getTime() - b.capturedAt.getTime();
  return diff !== 0 ? diff > 0 : a.donationId > b.donationId;
}

const named = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

export function buildRecognition(input: {
  fy: FinancialYear;
  lockedMonths: Iterable<PeriodMonth>;
  choices: readonly DonationChoice[];
  legs: readonly DonationLeg[];
}): Recognition {
  const locked = new Set(input.lockedMonths);
  const published = new Set(
    monthsOfFinancialYear(input.fy).filter((m) => locked.has(m))
  );
  const choices = new Map(input.choices.map((c) => [c.donationId, c]));

  const netByDonation = new Map<string, bigint>();
  for (const leg of input.legs) {
    if (!choices.has(leg.donationId)) {
      throw new Error(`No donation ${leg.donationId} for a ledger leg`);
    }
    if (!published.has(leg.month)) continue;
    netByDonation.set(
      leg.donationId,
      (netByDonation.get(leg.donationId) ?? 0n) + leg.amountMinor
    );
  }

  const latest = new Map<string, DonationChoice>();
  for (const c of input.choices) {
    const current = latest.get(c.donorId);
    if (!current || isLater(c, current)) latest.set(c.donorId, c);
  }

  const individualTotals = new Map<string, bigint>();
  const organisationTotals = new Map<string, bigint>();
  for (const [donationId, net] of netByDonation) {
    const c = choices.get(donationId)!;
    if (c.donorType === "individual") {
      individualTotals.set(
        c.donorId,
        (individualTotals.get(c.donorId) ?? 0n) + net
      );
    } else if (c.discloseOrganisation === true) {
      organisationTotals.set(
        c.donorId,
        (organisationTotals.get(c.donorId) ?? 0n) + net
      );
    }
  }

  const supporters = new Set<string>();
  for (const [donorId, total] of individualTotals) {
    const choice = latest.get(donorId)!;
    const name = named(choice.wallName);
    if (total > 0n && choice.showOnWall && name !== null) supporters.add(name);
  }

  const organisations: Recognition["organisations"] = [];
  for (const [donorId, totalMinor] of organisationTotals) {
    const choice = latest.get(donorId)!;
    const name = named(choice.organisationName);
    if (totalMinor > 0n && choice.discloseOrganisation === true && name) {
      organisations.push({ name, totalMinor });
    }
  }

  return {
    organisations: organisations.sort((a, b) =>
      a.totalMinor !== b.totalMinor
        ? a.totalMinor > b.totalMinor
          ? -1
          : 1
        : a.name.localeCompare(b.name, "en-IN")
    ),
    supporters: [...supporters].sort((a, b) => a.localeCompare(b, "en-IN")),
  };
}
