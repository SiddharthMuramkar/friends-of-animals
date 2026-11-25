// The public read model. Only explicitly locked periods are published.
// Read all parts in one database snapshot: locking or reopening a month
// cannot expose a name or amount from a different set of published months.

import { and, asc, eq, inArray, sum } from "drizzle-orm";

import { authorize, type PolicyContext } from "../../access/can";
import {
  ledgerAccount,
  ledgerLine,
  ledgerPeriod,
  ledgerPosting,
} from "../../db/schema";
import {
  balanceOf,
  SYSTEM_ACCOUNT_CODES,
  type PublicGroup,
} from "../ledger/domain/chart";
import { financialYearMonths } from "../ledger/domain/period";
import { donationCodes, recognition } from "./recognition";

export type Category = {
  group: PublicGroup;
  label: string | null;
  amountMinor: bigint;
};

type Totals = {
  incomeMinor: bigint;
  spendingMinor: bigint;
  donationsMinor: bigint;
};

export type PublishedMonth = Totals & {
  month: string;
  income: Category[];
  spending: Category[];
};

export type Transparency =
  | { published: false }
  | (Totals & {
      published: true;
      years: string[];
      fy: string;
      months: PublishedMonth[];
      organisations: { name: string; totalMinor: bigint }[];
      supporters: string[];
    });

const donationAccounts = new Set<string>(donationCodes);
const zero = (): Totals => ({
  incomeMinor: 0n,
  spendingMinor: 0n,
  donationsMinor: 0n,
});

function yearLabel(month: string): string {
  const [year, end] = financialYearMonths(month).filter(
    (_, i) => i === 0 || i === 11
  );
  return `${year!.slice(0, 4)}-${end!.slice(2, 4)}`;
}

function addCategory(categories: Category[], category: Category) {
  const prior = categories.find(
    (row) => row.group === category.group && row.label === category.label
  );
  if (prior) prior.amountMinor += category.amountMinor;
  else categories.push(category);
}

export async function getTransparency(
  ctx: PolicyContext,
  input: { fy?: string } = {}
): Promise<Transparency> {
  await authorize(ctx, "transparency.read");
  return ctx.db.transaction(
    async (tx) => {
      const periods = await tx
        .select({ month: ledgerPeriod.month })
        .from(ledgerPeriod)
        .where(eq(ledgerPeriod.status, "locked"))
        .orderBy(asc(ledgerPeriod.month));
      if (!periods.length) return { published: false };

      const years = [
        ...new Set(periods.map(({ month }) => yearLabel(month))),
      ].reverse();
      const fy = input.fy && years.includes(input.fy) ? input.fy : years[0]!;
      const months = periods
        .filter(({ month }) => yearLabel(month) === fy)
        .map(({ month }): PublishedMonth => ({
          month,
          ...zero(),
          income: [],
          spending: [],
        }));
      const monthKeys = months.map(({ month }) => month);
      const byMonth = new Map(months.map((row) => [row.month, row]));

      const rows = await tx
        .select({
          month: ledgerPosting.periodMonth,
          code: ledgerAccount.code,
          kind: ledgerAccount.kind,
          publicGroup: ledgerAccount.publicGroup,
          publicLabel: ledgerAccount.publicLabel,
          // Immutable system names are safe categories; never select
          // finance's private, freely editable account names.
          isSystem: ledgerAccount.isSystem,
          debitMinor: sum(ledgerLine.debitMinor),
          creditMinor: sum(ledgerLine.creditMinor),
        })
        .from(ledgerPosting)
        .innerJoin(ledgerLine, eq(ledgerLine.postingId, ledgerPosting.id))
        .innerJoin(ledgerAccount, eq(ledgerAccount.id, ledgerLine.accountId))
        .where(
          and(
            inArray(ledgerPosting.periodMonth, monthKeys),
            inArray(ledgerAccount.kind, ["income", "expense"])
          )
        )
        .groupBy(ledgerPosting.periodMonth, ledgerAccount.id)
        .orderBy(asc(ledgerAccount.code));

      const totals = zero();
      for (const row of rows) {
        const period = byMonth.get(row.month)!;
        const amountMinor = balanceOf(row.kind, {
          debitMinor: BigInt(row.debitMinor ?? 0),
          creditMinor: BigInt(row.creditMinor ?? 0),
        });
        const income = row.kind === "income";
        const key = income ? "incomeMinor" : "spendingMinor";
        period[key] += amountMinor;
        totals[key] += amountMinor;
        if (donationAccounts.has(row.code)) {
          period.donationsMinor += amountMinor;
          totals.donationsMinor += amountMinor;
        }
        const label =
          row.publicLabel ?? (row.isSystem ? systemLabel(row.code) : null);
        addCategory(income ? period.income : period.spending, {
          group: row.publicGroup ?? (income ? "income" : "administration"),
          label,
          amountMinor,
        });
      }

      return {
        published: true,
        years,
        fy,
        months,
        ...totals,
        ...(await recognition(tx, monthKeys)),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}

function systemLabel(code: string): string | null {
  switch (code) {
    case SYSTEM_ACCOUNT_CODES.registrationFees:
      return "Registration fees";
    case SYSTEM_ACCOUNT_CODES.individualDonations:
      return "Donations from individuals";
    case SYSTEM_ACCOUNT_CODES.corporateDonations:
      return "Donations from companies";
    case SYSTEM_ACCOUNT_CODES.csrDonations:
      return "CSR donations";
    default:
      return null;
  }
}
