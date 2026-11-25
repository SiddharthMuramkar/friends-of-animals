import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";
import {
  capturedDonation,
  openDonations,
  startedDonation,
} from "../donations/testing";
import { expenseEntry, twoFinanceUsers } from "../ledger/testing";

type Finance = Awaited<ReturnType<typeof twoFinanceUsers>>;

async function lock(h: Harness, finance: Finance, month: string) {
  const requested = await h
    .as(finance.requester.actor)
    .requestPeriodLock({ month });
  if (!requested.ok) throw new Error(JSON.stringify(requested));
  expect(
    await h
      .as(finance.approver.actor)
      .approveFinanceRequest({ requestId: requested.requestId })
  ).toEqual({ ok: true, status: "approved" });
}

describe("public transparency", () => {
  it("only publishes locked periods, uses ledger actuals rather than budgets and proves the same donations total as impact", async () => {
    const h = await createHarness();
    await openDonations(h);
    await capturedDonation(h);
    const finance = await twoFinanceUsers(h);
    const staff = h.as(finance.requester.actor);
    await staff.createManualEntry(
      expenseEntry("2027-01-03", 7_500n, "PRIVATE counterparty")
    );
    await staff.setBudget({
      accountCode: "5600",
      periodMonth: "2027-01",
      amount: "2000",
    });
    const visitor = h.as(h.visitor());
    expect(await visitor.getTransparency()).toEqual({ published: false });
    expect(await visitor.getFundsRaised()).toBeNull();

    await lock(h, finance, "2027-01");

    const view = await visitor.getTransparency();
    expect(view).toEqual({
      published: true,
      years: ["2026-27"],
      fy: "2026-27",
      months: [
        {
          month: "2027-01",
          incomeMinor: 50_000n,
          spendingMinor: 7_500n,
          donationsMinor: 50_000n,
          income: [
            {
              group: "income",
              label: "Donations from individuals",
              amountMinor: 50_000n,
            },
          ],
          spending: [{ group: "programs", label: null, amountMinor: 7_500n }],
        },
      ],
      incomeMinor: 50_000n,
      spendingMinor: 7_500n,
      donationsMinor: 50_000n,
      organisations: [],
      supporters: [],
    });
    expect(await visitor.getFundsRaised()).toEqual({
      fy: "2026-27",
      amountMinor: 50_000n,
      publishedThrough: "2027-01",
    });
    const report = await staff.budgetVsActual({
      from: "2027-01",
      to: "2027-01",
    });
    if (!report.ok) throw new Error(report.error);
    expect(report.totals.income.total.actualMinor).toBe(50_000n);
    expect(report.totals.expense.total.actualMinor).toBe(7_500n);
    expect(await h.as(finance.requester.actor).getTransparency()).toEqual(view);
    await expect(visitor.listPostings({})).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("names only opted-in supporters and disclosed organisations, with organisation totals net of published refunds", async () => {
    const h = await createHarness();
    await openDonations(h);
    await capturedDonation(h, { showOnWall: true, wallName: "Public A" });
    await capturedDonation(h, {
      name: "Private person",
      email: "private@example.test",
    });
    await capturedDonation(h, {
      donorType: "csr",
      organisationName: "Example Foundation",
      discloseOrganisation: true,
      name: "Private contact",
      email: "csr@example.test",
    });
    const second = await capturedDonation(h, {
      donorType: "corporate",
      organisationName: "Example Foundation",
      discloseOrganisation: true,
      amountMinor: 80_000n,
      email: "company@example.test",
    });
    await capturedDonation(h, {
      donorType: "corporate",
      organisationName: "Private Company",
      discloseOrganisation: false,
      showOnWall: true,
      wallName: "Private custom alias",
      email: "private-company@example.test",
    });
    await startedDonation(h, {
      showOnWall: true,
      wallName: "Unpaid supporter",
      email: "unpaid@example.test",
    });
    const finance = await twoFinanceUsers(h);
    await lock(h, finance, "2027-01");
    const visitor = h.as(h.visitor());
    const published = await visitor.getTransparency();
    expect(published).toMatchObject({
      donationsMinor: 280_000n,
      organisations: [{ name: "Example Foundation", totalMinor: 130_000n }],
      supporters: ["Public A"],
    });
    const json = JSON.stringify(published, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value
    );
    for (const secret of [
      "Private person",
      "Private contact",
      "Private Company",
      "Private custom alias",
      "Unpaid supporter",
      "example.test",
      second.donationId,
    ])
      expect(json).not.toContain(secret);

    const requested = await h
      .as(finance.requester.actor)
      .requestDonationRefund({
        donationId: second.donationId,
        reason: "Donor requested a return",
      });
    if (!requested.ok) throw new Error(requested.error);
    await h
      .as(finance.approver.actor)
      .approveRefund({ refundId: requested.refundId });
    await h.drain();
    // A late refund belongs to the next open month, not the locked one.
    expect(await visitor.getTransparency()).toEqual(published);
    h.clock.advance({ days: 30 });
    const newFinance = await twoFinanceUsers(h);
    await lock(h, newFinance, "2027-02");
    expect(await visitor.getTransparency()).toMatchObject({
      donationsMinor: 200_000n,
      months: [
        { month: "2027-01", donationsMinor: 280_000n },
        { month: "2027-02", donationsMinor: -80_000n },
      ],
      organisations: [{ name: "Example Foundation", totalMinor: 50_000n }],
      supporters: ["Public A"],
    });
  });
});
