import { describe, expect, it } from "vitest";

import {
  buildFigures,
  fundsRaised,
  type AccountTotal,
  type PublicAccount,
} from "./figures";

const FY = { startYear: 2026, label: "2026-27" };

// The proposed seeded chart, with the public labels finance would give it.
const ACCOUNTS: PublicAccount[] = [
  { code: "1000", kind: "asset", publicLabel: null, publicGroup: null },
  { code: "1100", kind: "asset", publicLabel: null, publicGroup: null },
  { code: "2100", kind: "liability", publicLabel: null, publicGroup: null },
  { code: "3000", kind: "equity", publicLabel: null, publicGroup: null },
  {
    code: "4100",
    kind: "income",
    publicLabel: "Registration fees",
    publicGroup: "income",
  },
  {
    code: "4200",
    kind: "income",
    publicLabel: "Donations",
    publicGroup: "income",
  },
  {
    code: "4210",
    kind: "income",
    publicLabel: "Donations",
    publicGroup: "income",
  },
  {
    code: "4220",
    kind: "income",
    publicLabel: "CSR contributions",
    publicGroup: "income",
  },
  { code: "4900", kind: "income", publicLabel: null, publicGroup: null },
  {
    code: "5100",
    kind: "expense",
    publicLabel: "Prizes and awards",
    publicGroup: "programs",
  },
  {
    code: "5400",
    kind: "expense",
    publicLabel: "Running the platform",
    publicGroup: "administration",
  },
  {
    code: "5500",
    kind: "expense",
    publicLabel: "Running the platform",
    publicGroup: "administration",
  },
  { code: "5900", kind: "expense", publicLabel: null, publicGroup: null },
];

const DONATION_ACCOUNTS = new Set(["4200", "4210", "4220"]);

const total = (
  month: string,
  accountCode: string,
  debitMinor: bigint,
  creditMinor: bigint
): AccountTotal => ({ month, accountCode, debitMinor, creditMinor });

// October: a Rs 500 individual donation, a Rs 20,000 corporate one, a
// Rs 1,000 CSR one, Rs 300 of registration fees, a Rs 200 refund of part
// of the corporate donation, Rs 150 of other income, a Rs 900 prize and
// Rs 250 of platform costs split over two accounts. November and a month
// of the previous year carry figures that must never show.
const TOTALS: AccountTotal[] = [
  total("2026-10", "1100", 2_195_000n, 20_000n),
  total("2026-10", "1000", 15_000n, 115_000n),
  total("2026-10", "4200", 0n, 50_000n),
  total("2026-10", "4210", 20_000n, 2_000_000n),
  total("2026-10", "4220", 0n, 100_000n),
  total("2026-10", "4100", 0n, 30_000n),
  total("2026-10", "4900", 0n, 15_000n),
  total("2026-10", "5100", 90_000n, 0n),
  total("2026-10", "5400", 10_000n, 0n),
  total("2026-10", "5500", 15_000n, 0n),
  // Money held to refund a foreign payment is a liability, never income.
  total("2026-10", "2100", 0n, 70_000n),
  total("2026-10", "1100", 70_000n, 0n),
  total("2026-11", "4200", 0n, 7_777_700n),
  total("2026-11", "1100", 7_777_700n, 0n),
  total("2025-12", "4200", 0n, 123_400n),
  total("2025-12", "1100", 123_400n, 0n),
];

function october(lockedMonths: string[] = ["2025-12", "2026-10"]) {
  return buildFigures({
    fy: FY,
    lockedMonths,
    accounts: ACCOUNTS,
    totals: TOTALS,
    donationAccountCodes: DONATION_ACCOUNTS,
  });
}

describe("buildFigures", () => {
  it("shows only the locked months of the chosen year", () => {
    const figures = october();
    expect(figures.fy).toBe("2026-27");
    expect(figures.months.map((m) => m.month)).toEqual(["2026-10"]);
    expect(figures.publishedThrough).toBe("2026-10");
    expect(JSON.stringify(figures, bigints)).not.toContain("77777");
  });

  it("totals income and spending exactly as the ledger does", () => {
    const [oct] = october().months;
    // Income accounts: credits minus debits. Spending: debits minus credits.
    expect(oct!.incomeMinor).toBe(
      50_000n + (2_000_000n - 20_000n) + 100_000n + 30_000n + 15_000n
    );
    expect(oct!.spendingMinor).toBe(90_000n + 10_000n + 15_000n);
  });

  it("groups accounts under their public labels", () => {
    const [oct] = october().months;
    expect(oct!.income).toEqual([
      { label: "Donations", group: "income", amountMinor: 2_030_000n },
      { label: "CSR contributions", group: "income", amountMinor: 100_000n },
      { label: "Registration fees", group: "income", amountMinor: 30_000n },
      // An account without a public label still counts, as "other".
      { label: null, group: null, amountMinor: 15_000n },
    ]);
    expect(oct!.spending).toEqual([
      { label: "Prizes and awards", group: "programs", amountMinor: 90_000n },
      {
        label: "Running the platform",
        group: "administration",
        amountMinor: 25_000n,
      },
    ]);
  });

  it("shows an account with a group but no label under its group", () => {
    const figures = buildFigures({
      fy: FY,
      lockedMonths: ["2026-10"],
      accounts: [
        // As the chart is seeded: groups, but no labels until finance adds them.
        {
          code: "5100",
          kind: "expense",
          publicLabel: null,
          publicGroup: "programs",
        },
        {
          code: "5600",
          kind: "expense",
          publicLabel: null,
          publicGroup: "programs",
        },
        {
          code: "5400",
          kind: "expense",
          publicLabel: null,
          publicGroup: "administration",
        },
        { code: "5900", kind: "expense", publicLabel: null, publicGroup: null },
      ],
      totals: [
        total("2026-10", "5100", 90_000n, 0n),
        total("2026-10", "5600", 10_000n, 0n),
        total("2026-10", "5400", 25_000n, 0n),
        total("2026-10", "5900", 5_000n, 0n),
      ],
      donationAccountCodes: DONATION_ACCOUNTS,
    });
    expect(figures.months[0]!.spending).toEqual([
      { label: null, group: "programs", amountMinor: 100_000n },
      { label: null, group: "administration", amountMinor: 25_000n },
      { label: null, group: null, amountMinor: 5_000n },
    ]);
  });

  it("keeps one label used in two groups as two categories", () => {
    const figures = buildFigures({
      fy: FY,
      lockedMonths: ["2026-10"],
      accounts: [
        {
          code: "5300",
          kind: "expense",
          publicLabel: "Travel",
          publicGroup: "programs",
        },
        {
          code: "5900",
          kind: "expense",
          publicLabel: "Travel",
          publicGroup: "administration",
        },
      ],
      totals: [
        total("2026-10", "5300", 40_000n, 0n),
        total("2026-10", "5900", 10_000n, 0n),
      ],
      donationAccountCodes: DONATION_ACCOUNTS,
    });
    expect(figures.months[0]!.spending).toEqual([
      { label: "Travel", group: "programs", amountMinor: 40_000n },
      { label: "Travel", group: "administration", amountMinor: 10_000n },
    ]);
  });

  it("counts donations net of refunds, from the donation accounts only", () => {
    const figures = october();
    expect(figures.months[0]!.donationsMinor).toBe(2_130_000n);
    expect(figures.yearToDate.donationsMinor).toBe(2_130_000n);
  });

  it("adds the published months up for the year to date", () => {
    const figures = october(["2026-10", "2026-11"]);
    expect(figures.months.map((m) => m.month)).toEqual(["2026-10", "2026-11"]);
    expect(figures.publishedThrough).toBe("2026-11");
    expect(figures.yearToDate.donationsMinor).toBe(2_130_000n + 7_777_700n);
    expect(figures.yearToDate.incomeMinor).toBe(
      figures.months[0]!.incomeMinor + figures.months[1]!.incomeMinor
    );
    expect(figures.yearToDate.income[0]).toEqual({
      label: "Donations",
      group: "income",
      amountMinor: 2_030_000n + 7_777_700n,
    });
  });

  it("leaves out categories that net to zero and keeps negative ones", () => {
    const figures = buildFigures({
      fy: FY,
      lockedMonths: ["2026-12"],
      accounts: ACCOUNTS,
      totals: [
        total("2026-12", "4100", 30_000n, 30_000n),
        // A refund of an October donation, posted in December.
        total("2026-12", "4200", 50_000n, 0n),
        total("2026-12", "1100", 0n, 50_000n),
      ],
      donationAccountCodes: DONATION_ACCOUNTS,
    });
    expect(figures.months[0]!.income).toEqual([
      { label: "Donations", group: "income", amountMinor: -50_000n },
    ]);
    expect(figures.months[0]!.donationsMinor).toBe(-50_000n);
  });

  it("shows an empty year when none of its months is locked", () => {
    const figures = october([]);
    expect(figures.months).toEqual([]);
    expect(figures.publishedThrough).toBeNull();
    expect(figures.yearToDate).toEqual({
      income: [],
      spending: [],
      incomeMinor: 0n,
      spendingMinor: 0n,
      donationsMinor: 0n,
    });
  });

  it("refuses a total for an account it doesn't know", () => {
    expect(() =>
      buildFigures({
        fy: FY,
        lockedMonths: ["2026-10"],
        accounts: ACCOUNTS,
        totals: [total("2026-10", "4999", 0n, 100n)],
        donationAccountCodes: DONATION_ACCOUNTS,
      })
    ).toThrow(/4999/);
  });

  it("carries no account codes, so nothing links back to ledger rows", () => {
    const json = JSON.stringify(october(), bigints);
    for (const { code } of ACCOUNTS) expect(json).not.toContain(`"${code}"`);
  });
});

describe("fundsRaised", () => {
  it("is the year-to-date donations total of the same figures", () => {
    const figures = october(["2026-10", "2026-11"]);
    expect(fundsRaised(figures)).toEqual({
      fy: "2026-27",
      amountMinor: figures.yearToDate.donationsMinor,
      publishedThrough: "2026-11",
    });
  });
});

function bigints(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
