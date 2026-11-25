import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { ledgerLine, ledgerPosting } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { capturedBatch } from "@/server/modules/payments/refunds/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  expenseEntry,
  ledgerAudit,
  periodRow,
  postingRows,
  twoFinanceUsers,
  type Staff,
} from "./testing";

// #109: a locked month refuses every new posting. Finance's own entries
// and reversals aimed at it are refused; a correction goes in as a
// reversal in an open month; an automatic posting the platform can't
// refuse lands after the lock line as a late adjustment. The harness
// clock starts on 15 January 2027 (IST).

async function lock(
  h: Harness,
  month: string,
  { requester, approver }: { requester: Staff; approver: Staff }
) {
  const requested = await h.as(requester.actor).requestPeriodLock({ month });
  if (!requested.ok) throw new Error(JSON.stringify(requested));
  const approved = await h
    .as(approver.actor)
    .approveFinanceRequest({ requestId: requested.requestId });
  if (!approved.ok) throw new Error(JSON.stringify(approved));
}

async function linesOfMonth(h: Harness, month: string) {
  return h.db
    .select({
      postingId: ledgerLine.postingId,
      debitMinor: ledgerLine.debitMinor,
      creditMinor: ledgerLine.creditMinor,
    })
    .from(ledgerLine)
    .innerJoin(ledgerPosting, eq(ledgerPosting.id, ledgerLine.postingId))
    .where(eq(ledgerPosting.periodMonth, month))
    .orderBy(asc(ledgerLine.id));
}

describe("a locked period", () => {
  it("refuses a manual entry dated in it, or before it, and writes nothing", async () => {
    const h = await createHarness();
    const finance = await twoFinanceUsers(h);
    await h
      .as(finance.requester.actor)
      .createManualEntry(expenseEntry("2026-12-10", 10_000n));
    await lock(h, "2026-12", finance);
    const before = {
      postings: await postingRows(h),
      audit: await ledgerAudit(h),
    };

    for (const date of ["2026-12-31", "2026-07-01"]) {
      expect(
        await h
          .as(finance.requester.actor)
          .createManualEntry(expenseEntry(date, 5_000n))
      ).toEqual({ ok: false, error: "period_locked" });
    }
    expect(await postingRows(h)).toEqual(before.postings);
    expect(await ledgerAudit(h)).toEqual(before.audit);
    expect(await periodRow(h, "2026-07")).toBeUndefined();
  });

  it("takes a correction of its posting as a reversal dated in the open month, leaving its own lines unchanged", async () => {
    const h = await createHarness();
    const finance = await twoFinanceUsers(h);
    const entry = await h
      .as(finance.requester.actor)
      .createManualEntry(expenseEntry("2026-12-10", 10_000n));
    if (!entry.ok || entry.status !== "posted") throw new Error("not posted");
    await lock(h, "2026-12", finance);
    const december = await linesOfMonth(h, "2026-12");

    const reversal = await h
      .as(finance.requester.actor)
      .reversePosting(entry.seq);
    expect(reversal).toMatchObject({ ok: true, seq: 2n });
    expect(await postingRows(h)).toMatchObject([
      { seq: 1n, periodMonth: "2026-12" },
      {
        seq: 2n,
        sourceType: "reversal",
        periodMonth: "2027-01",
        reversalOfPostingId: entry.postingId,
      },
    ]);
    expect(await linesOfMonth(h, "2026-12")).toEqual(december);
  });

  it("refuses a reversal while the current month is locked", async () => {
    const h = await createHarness();
    const finance = await twoFinanceUsers(h);
    const entry = await h
      .as(finance.requester.actor)
      .createManualEntry(expenseEntry("2027-01-02", 10_000n));
    if (!entry.ok || entry.status !== "posted") throw new Error("not posted");
    await lock(h, "2027-01", finance);

    expect(
      await h.as(finance.requester.actor).reversePosting(entry.seq)
    ).toEqual({ ok: false, error: "period_locked" });
    expect(await postingRows(h)).toHaveLength(1);
  });

  it("refuses a hand-written INSERT into a closed month in the database itself", async () => {
    const h = await createHarness();
    await lock(h, "2026-12", await twoFinanceUsers(h));
    const now = h.clock.now();
    for (const periodMonth of ["2026-12", "2026-01"]) {
      await expect(
        h.db.insert(ledgerPosting).values({
          id: uuidv7(now),
          sourceType: "manual",
          sourceId: uuidv7(now),
          occurredAt: now,
          periodMonth,
          description: "Back-dated by hand",
          expectedLineCount: 2,
          createdAt: now,
        })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          message: expect.stringContaining("period_locked"),
        }),
      });
    }
    expect(await postingRows(h)).toEqual([]);
  });
});

describe("late adjustments", () => {
  it("posts a capture dated in a locked month into the first month after the lock line, and leaves the locked month's lines alone", async () => {
    const h = await createHarness();
    const finance = await twoFinanceUsers(h);
    await h
      .as(finance.requester.actor)
      .createManualEntry(expenseEntry("2027-01-05", 7_500n));
    // Captured on 15 January; the ledger hears of it only after January locks.
    const paid = await capturedBatch(h, { students: 2 });
    await lock(h, "2027-01", finance);
    const january = await linesOfMonth(h, "2027-01");

    await h.drain();

    const capture = (await postingRows(h)).find(
      ({ sourceType }) => sourceType === "payment_capture"
    );
    expect(capture).toMatchObject({
      sourceId: paid.paymentId,
      occurredAt: h.clock.now(),
      periodMonth: "2027-02",
    });
    expect(await linesOfMonth(h, "2027-01")).toEqual(january);
    expect(await periodRow(h, "2027-02")).toMatchObject({ status: "open" });
    expect(
      await h.as(finance.requester.actor).getPosting(capture!.seq)
    ).toMatchObject({
      ok: true,
      posting: { periodMonth: "2027-02", lateAdjustment: true },
    });
    const logged = (await ledgerAudit(h)).find(
      ({ entityId }) => entityId === capture!.id
    );
    expect(logged?.after).toMatchObject({
      periodMonth: "2027-02",
      lateAdjustment: true,
    });
  });

  it("is not a late adjustment when the posting's own month is open", async () => {
    const h = await createHarness();
    const finance = await twoFinanceUsers(h);
    const entry = await h
      .as(finance.requester.actor)
      .createManualEntry(expenseEntry("2027-01-05", 7_500n));
    if (!entry.ok || entry.status !== "posted") throw new Error("not posted");
    expect(
      await h.as(finance.requester.actor).getPosting(entry.seq)
    ).toMatchObject({
      ok: true,
      posting: { periodMonth: "2027-01", lateAdjustment: false },
    });
  });
});
