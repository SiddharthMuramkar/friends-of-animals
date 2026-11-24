import { describe, expect, it } from "vitest";

import { ledgerBudget } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { ledgerAudit, signInAs, type Staff } from "./testing";

// #109 unit 109b: finance sets budgets per category per month and reads
// budget versus actual. The harness clock starts on 15 January 2027 (IST),
// in the financial year April 2026 to March 2027.

const rupees = (amount: number) => BigInt(amount) * 100n;

async function entry(
  h: Harness,
  finance: Staff,
  date: string,
  debit: string,
  credit: string,
  amount: number
) {
  const posted = await h.as(finance.actor).createManualEntry({
    date,
    description: `Test entry ${date} ${debit} ${credit}`,
    lines: [
      { accountCode: debit, side: "debit", amountMinor: rupees(amount) },
      { accountCode: credit, side: "credit", amountMinor: rupees(amount) },
    ],
  });
  if (!posted.ok || posted.status !== "posted")
    throw new Error(JSON.stringify(posted));
}

async function budget(
  h: Harness,
  finance: Staff,
  accountCode: string,
  periodMonth: string,
  amount: string
) {
  const set = await h
    .as(finance.actor)
    .setBudget({ accountCode, periodMonth, amount });
  if (!set.ok) throw new Error(JSON.stringify(set));
}

describe("setting a budget", () => {
  it("creates one budget per category and month, changes it, clears it, and audits each change with amounts and ids only", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    const set = (amount: string) =>
      h
        .as(finance.actor)
        .setBudget({ accountCode: "5600", periodMonth: "2027-01", amount });

    expect(await set("50,000")).toEqual({
      ok: true,
      amountMinor: rupees(50_000),
      changed: true,
    });
    expect(await set("1,25,000.50")).toEqual({
      ok: true,
      amountMinor: 12_500_050n,
      changed: true,
    });
    expect(await set("1,25,000.50")).toEqual({
      ok: true,
      amountMinor: 12_500_050n,
      changed: false,
    });
    const rows = await h.db.select().from(ledgerBudget);
    expect(rows).toEqual([
      expect.objectContaining({
        periodMonth: "2027-01",
        amountMinor: 12_500_050n,
        createdByUserId: finance.userId,
        updatedByUserId: finance.userId,
      }),
    ]);
    expect(await set("")).toEqual({
      ok: true,
      amountMinor: null,
      changed: true,
    });
    expect(await h.db.select().from(ledgerBudget)).toEqual([]);

    const audit = (await ledgerAudit(h)).filter(
      ({ action }) => action === "ledger.budget_set"
    );
    expect(
      audit.map(({ before, after, actorRole }) => ({
        before,
        after,
        actorRole,
      }))
    ).toEqual([
      {
        before: null,
        after: {
          accountCode: "5600",
          periodMonth: "2027-01",
          amountMinor: "5000000",
        },
        actorRole: "finance",
      },
      {
        before: {
          accountCode: "5600",
          periodMonth: "2027-01",
          amountMinor: "5000000",
        },
        after: {
          accountCode: "5600",
          periodMonth: "2027-01",
          amountMinor: "12500050",
        },
        actorRole: "finance",
      },
      {
        before: {
          accountCode: "5600",
          periodMonth: "2027-01",
          amountMinor: "12500050",
        },
        after: null,
        actorRole: "finance",
      },
    ]);
  });

  it.each([
    [{ accountCode: "1000", amount: "100" }, "not_budgetable"],
    [{ accountCode: "3000", amount: "100" }, "not_budgetable"],
    [{ accountCode: "5999", amount: "100" }, "not_found"],
    [{ accountCode: "5600", amount: "-5" }, "invalid_amount"],
    [{ accountCode: "5600", amount: "12.345" }, "invalid_amount"],
    [{ accountCode: "5600", amount: "1,00,00,00,00,001" }, "too_large"],
    [{ accountCode: "56", amount: "100" }, "invalid_input"],
  ] as const)("refuses %j with %s", async (input, error) => {
    const h = await createHarness();
    const finance = await signInAs(h);
    expect(
      await h.as(finance.actor).setBudget({ periodMonth: "2027-01", ...input })
    ).toEqual({ ok: false, error });
    expect(await h.db.select().from(ledgerBudget)).toEqual([]);
  });

  it("refuses a bad month, and a budget on an inactive category", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    for (const periodMonth of ["2027-13", "2027-1", ""]) {
      expect(
        await h
          .as(finance.actor)
          .setBudget({ accountCode: "5600", periodMonth, amount: "100" })
      ).toEqual({ ok: false, error: "invalid_input" });
    }
    await h.as(finance.actor).deactivateLedgerAccount({ code: "5300" });
    expect(
      await h
        .as(finance.actor)
        .setBudget({ accountCode: "5300", periodMonth: "2027-01", amount: "1" })
    ).toEqual({ ok: false, error: "inactive_account" });
  });

  it("allows a budget for a locked month: it plans, it doesn't post", async () => {
    const h = await createHarness();
    const requester = await signInAs(h);
    const approver = await signInAs(h);
    const lock = await h
      .as(requester.actor)
      .requestPeriodLock({ month: "2026-12" });
    if (!lock.ok) throw new Error(JSON.stringify(lock));
    await h
      .as(approver.actor)
      .approveFinanceRequest({ requestId: lock.requestId });
    expect(
      await h.as(requester.actor).setBudget({
        accountCode: "5600",
        periodMonth: "2026-12",
        amount: "10",
      })
    ).toMatchObject({ ok: true, changed: true });
  });
});

describe("budget versus actual", () => {
  it("matches a hand-computed report for two categories over two months", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    // Other income (4900) and Events and outreach (5600).
    await entry(h, finance, "2026-12-05", "1000", "4900", 30_000);
    await entry(h, finance, "2026-12-09", "5600", "1000", 12_000);
    await entry(h, finance, "2027-01-03", "1000", "4900", 10_000);
    await entry(h, finance, "2027-01-04", "4900", "1000", 2_000);
    await entry(h, finance, "2027-01-06", "5600", "1000", 25_000);
    // Outside the range: not counted.
    await entry(h, finance, "2026-11-20", "1000", "4900", 49_000);
    await budget(h, finance, "4900", "2026-12", "25,000");
    await budget(h, finance, "4900", "2027-01", "20,000");
    await budget(h, finance, "5600", "2026-12", "15,000");
    await budget(h, finance, "5600", "2027-01", "20,000");

    const report = await h
      .as(finance.actor)
      .budgetVsActual({ from: "2026-12", to: "2027-01" });
    if (!report.ok) throw new Error(JSON.stringify(report));
    expect(report.months).toEqual(["2026-12", "2027-01"]);
    const row = (code: string) =>
      report.rows.find(({ account }) => account.code === code);

    expect(row("4900")).toMatchObject({
      months: [
        {
          periodMonth: "2026-12",
          budgetMinor: rupees(25_000),
          actualMinor: rupees(30_000),
          varianceMinor: rupees(5_000),
          usedPercent: 120,
          favourable: true,
        },
        {
          periodMonth: "2027-01",
          budgetMinor: rupees(20_000),
          actualMinor: rupees(8_000),
          varianceMinor: -rupees(12_000),
          usedPercent: 40,
          favourable: false,
        },
      ],
      total: {
        budgetMinor: rupees(45_000),
        actualMinor: rupees(38_000),
        varianceMinor: -rupees(7_000),
        usedPercent: 84.4,
        favourable: false,
      },
    });
    expect(row("5600")).toMatchObject({
      months: [
        {
          budgetMinor: rupees(15_000),
          actualMinor: rupees(12_000),
          varianceMinor: -rupees(3_000),
          usedPercent: 80,
          favourable: true,
        },
        {
          budgetMinor: rupees(20_000),
          actualMinor: rupees(25_000),
          varianceMinor: rupees(5_000),
          usedPercent: 125,
          favourable: false,
        },
      ],
      total: {
        budgetMinor: rupees(35_000),
        actualMinor: rupees(37_000),
        varianceMinor: rupees(2_000),
        usedPercent: 105.7,
        favourable: false,
      },
    });
    // A category with neither budget nor activity shows empty.
    expect(row("5100")).toMatchObject({
      total: { budgetMinor: null, actualMinor: 0n, usedPercent: null },
    });
    expect(report.totals).toEqual({
      income: {
        months: [
          {
            periodMonth: "2026-12",
            budgetMinor: rupees(25_000),
            actualMinor: rupees(30_000),
          },
          {
            periodMonth: "2027-01",
            budgetMinor: rupees(20_000),
            actualMinor: rupees(8_000),
          },
        ],
        total: { budgetMinor: rupees(45_000), actualMinor: rupees(38_000) },
      },
      expense: {
        months: [
          {
            periodMonth: "2026-12",
            budgetMinor: rupees(15_000),
            actualMinor: rupees(12_000),
          },
          {
            periodMonth: "2027-01",
            budgetMinor: rupees(20_000),
            actualMinor: rupees(25_000),
          },
        ],
        total: { budgetMinor: rupees(35_000), actualMinor: rupees(37_000) },
      },
      net: {
        months: [
          {
            periodMonth: "2026-12",
            budgetMinor: rupees(10_000),
            actualMinor: rupees(18_000),
          },
          {
            periodMonth: "2027-01",
            budgetMinor: 0n,
            actualMinor: -rupees(17_000),
          },
        ],
        total: { budgetMinor: rupees(10_000), actualMinor: rupees(1_000) },
      },
    });
  });

  it("covers the current financial year by default and keeps an inactive category only while it has a budget or activity", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    await budget(h, finance, "5300", "2026-06", "5,000");
    await h.as(finance.actor).deactivateLedgerAccount({ code: "5300" });
    await h.as(finance.actor).deactivateLedgerAccount({ code: "5200" });

    const report = await h.as(finance.actor).budgetVsActual();
    if (!report.ok) throw new Error(JSON.stringify(report));
    expect(report.months).toHaveLength(12);
    expect(report.months[0]).toBe("2026-04");
    expect(report.months.at(-1)).toBe("2027-03");
    const codes = report.rows.map(({ account }) => account.code);
    expect(codes).toContain("5300");
    expect(codes).not.toContain("5200");
    expect(codes).not.toContain("1000");
    expect(
      report.rows.find(({ account }) => account.code === "5300")
    ).toMatchObject({
      isActive: false,
    });
    // Income first, then expenses, each by code.
    expect(codes.indexOf("4900")).toBeLessThan(codes.indexOf("5100"));
  });

  it("refuses a range it can't show", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    expect(
      await h
        .as(finance.actor)
        .budgetVsActual({ from: "2027-01", to: "2026-12" })
    ).toEqual({ ok: false, error: "range_reversed" });
    expect(
      await h
        .as(finance.actor)
        .budgetVsActual({ from: "2025-01", to: "2027-03" })
    ).toEqual({ ok: false, error: "range_too_long" });
  });
});

describe("budget authorization", () => {
  it.each(["staff_admin", "super_admin", "competition_manager", null] as const)(
    "refuses a %s who doesn't hold finance",
    async (role) => {
      const h = await createHarness();
      const other = await signInAs(h, role);
      await expect(
        h.as(other.actor).setBudget({
          accountCode: "5600",
          periodMonth: "2027-01",
          amount: "1",
        })
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(h.as(other.actor).budgetVsActual()).rejects.toMatchObject({
        code: "forbidden",
      });
      expect(await h.db.select().from(ledgerBudget)).toEqual([]);
    }
  );

  it("refuses a visitor", async () => {
    const h = await createHarness();
    await expect(h.as(h.visitor()).budgetVsActual()).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
