import { describe, expect, it } from "vitest";

import { capturedBatch } from "@/server/modules/payments/refunds/testing";
import { signInStaff } from "@/server/modules/payments/testing";
import { createHarness } from "@/test/harness";

import { ledgerTrialBalance } from "./queries";

describe("the ledger's finance views", () => {
  it("filters by an account on any line and whole IST days, with stable keyset pages and totals", async () => {
    const h = await createHarness();
    const { actor } = await signInStaff(h);
    const finance = h.as(actor);
    const entries = [
      { code: "5100", date: "2027-01-03", amount: 100n },
      { code: "5200", date: "2027-01-04", amount: 200n },
      { code: "5100", date: "2027-01-03", amount: 300n },
      { code: "5100", date: "2027-01-05", amount: 400n },
    ];
    for (const [index, entry] of entries.entries()) {
      expect(
        await finance.createManualEntry({
          date: entry.date,
          description: `Test posting ${index + 1}`,
          lines: [
            { accountCode: "1000", side: "credit", amountMinor: entry.amount },
            {
              accountCode: entry.code,
              side: "debit",
              amountMinor: entry.amount,
              memo: "Example line",
            },
          ],
        })
      ).toMatchObject({ ok: true });
    }
    const input = {
      accountCode: "5100",
      from: "2027-01-03",
      to: "2027-01-04",
      limit: 1,
    };
    expect(await finance.listPostings(input)).toMatchObject({
      ok: true,
      postings: [{ seq: 3n, debitMinor: 300n, creditMinor: 300n }],
      totals: { debitMinor: 400n, creditMinor: 400n },
      nextCursor: 3n,
    });
    expect(await finance.listPostings({ ...input, cursor: 3n })).toMatchObject({
      ok: true,
      postings: [{ seq: 1n, debitMinor: 100n, creditMinor: 100n }],
      totals: { debitMinor: 400n, creditMinor: 400n },
      nextCursor: null,
    });
    expect(await finance.getPosting(3n)).toMatchObject({
      ok: true,
      posting: {
        seq: 3n,
        lines: [
          { accountCode: "1000", debitMinor: 0n, creditMinor: 300n },
          {
            accountCode: "5100",
            debitMinor: 300n,
            creditMinor: 0n,
            memo: "Example line",
          },
        ],
      },
    });
    expect(await finance.getPosting(999n)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await finance.listLedgerAccounts()).toContainEqual(
      expect.objectContaining({ code: "5100", isActive: true })
    );
  });

  it("puts an evening UTC capture on the next IST day and in the next month", async () => {
    const h = await createHarness({ now: "2026-04-30T19:00:00Z" });
    const { paymentId } = await capturedBatch(h, { students: 1 });
    await h.drain();
    const { actor } = await signInStaff(h);
    const finance = h.as(actor);
    expect(
      await finance.listPostings({ from: "2026-04-30", to: "2026-04-30" })
    ).toMatchObject({ ok: true, postings: [] });
    expect(
      await finance.listPostings({ from: "2026-05-01", to: "2026-05-01" })
    ).toMatchObject({
      ok: true,
      postings: [{ periodMonth: "2026-05", sourceType: "payment_capture" }],
    });
    expect(await finance.getPosting(1n)).toMatchObject({
      ok: true,
      posting: { sourceId: paymentId },
    });
    expect(
      await ledgerTrialBalance(h.db, { from: "2026-05-01", to: "2026-05-01" })
    ).toEqual({
      accounts: [
        { accountCode: "1100", debitMinor: 50_000n, creditMinor: 0n },
        { accountCode: "4100", debitMinor: 0n, creditMinor: 50_000n },
      ],
      debitMinor: 50_000n,
      creditMinor: 50_000n,
      balanced: true,
    });
  });

  it.each(["competition_manager", "staff_admin", "super_admin", null] as const)(
    "refuses the ledger views for %s without a finance grant",
    async (role) => {
      const h = await createHarness();
      const { actor } = await signInStaff(h, role);
      const app = h.as(actor);
      await expect(app.listPostings({})).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(app.getPosting(1n)).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(app.listLedgerAccounts()).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  );

  it("requires the staff second factor in the session that reads the ledger", async () => {
    const h = await createHarness();
    const user = await h.seed.member();
    await h.seed.grant(user, { role: "finance", scope: { type: "global" } });
    await h.seed.authenticator(user);
    const actor = await h.signIn(user, undefined, { secondFactor: false });
    const app = h.as(actor);

    await expect(app.listPostings({})).rejects.toMatchObject({
      code: "second_factor_required",
    });
    await expect(app.getPosting(1n)).rejects.toMatchObject({
      code: "second_factor_required",
    });
    await expect(app.listLedgerAccounts()).rejects.toMatchObject({
      code: "second_factor_required",
    });
  });
});
