import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import {
  expenseEntry,
  ledgerAudit,
  postingRows,
  requestRow,
  requestRows,
  signInAs,
  stepUp,
  twoFinanceUsers,
} from "./testing";

// #109: a manual entry moving more than the threshold in settings (Rs
// 50,000 by default) waits for a second finance user; one at or below it
// posts at once.

const RS_50_000 = 5_000_000n;

describe("manual entries above the approval threshold", () => {
  it("wait for a second finance user, then post exactly once with the requester as author", async () => {
    const h = await createHarness();
    const { requester, approver } = await twoFinanceUsers(h);

    const asked = await h
      .as(requester.actor)
      .createManualEntry(
        expenseEntry("2027-01-10", RS_50_000 + 1n, "Venue for the awards")
      );
    expect(asked).toEqual({
      ok: true,
      status: "pending_approval",
      requestId: expect.any(String),
    });
    if (!asked.ok || asked.status !== "pending_approval") return;
    expect(await postingRows(h)).toEqual([]);
    expect(await requestRow(h, asked.requestId)).toMatchObject({
      operation: "manual_entry",
      status: "pending",
      payload: {
        date: "2027-01-10",
        description: "Venue for the awards",
        lines: [
          { accountCode: "5600", side: "debit", amountMinor: "5000001" },
          { accountCode: "1000", side: "credit", amountMinor: "5000001" },
        ],
      },
    });
    const requested = (await ledgerAudit(h)).at(-1);
    expect(requested).toMatchObject({
      action: "ledger.approval_requested",
      after: {
        operation: "manual_entry",
        status: "pending",
        totalMinor: "5000001",
        lineCount: 2,
      },
    });
    expect(JSON.stringify(requested)).not.toContain("Venue for the awards");

    await stepUp(h, approver);
    expect(
      await h
        .as(approver.actor)
        .approveFinanceRequest({ requestId: asked.requestId })
    ).toEqual({ ok: true, status: "approved", seq: 1n });
    const [posting] = await postingRows(h);
    expect(posting).toMatchObject({
      id: asked.requestId,
      sourceType: "manual",
      sourceId: asked.requestId,
      periodMonth: "2027-01",
      description: "Venue for the awards",
      createdByUserId: requester.userId,
    });
    expect(await requestRow(h, asked.requestId)).toMatchObject({
      status: "approved",
      executedPostingId: posting!.id,
    });
    expect(
      await h
        .as(approver.actor)
        .approveFinanceRequest({ requestId: asked.requestId })
    ).toEqual({ ok: false, error: "not_pending" });
    expect(await postingRows(h)).toHaveLength(1);
  });

  it("post at once at or below the threshold", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    expect(
      await h
        .as(finance.actor)
        .createManualEntry(expenseEntry("2027-01-10", RS_50_000))
    ).toMatchObject({ ok: true, status: "posted", seq: 1n });
    expect(await requestRows(h)).toEqual([]);
  });

  it("follow a change of the setting on the next entry", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    await h.settings.set("ledger.manualEntryApprovalThresholdRupees", 100);
    expect(
      await h
        .as(finance.actor)
        .createManualEntry(expenseEntry("2027-01-10", 10_001n))
    ).toMatchObject({ ok: true, status: "pending_approval" });
    expect(
      await h
        .as(finance.actor)
        .createManualEntry(expenseEntry("2027-01-10", 10_000n))
    ).toMatchObject({ ok: true, status: "posted" });
  });

  it("are checked before they wait: an unbalanced or unknown-account entry is refused, not queued", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    expect(
      await h.as(finance.actor).createManualEntry({
        date: "2027-01-10",
        description: "Unbalanced",
        lines: [
          { accountCode: "5600", side: "debit", amountMinor: RS_50_000 * 2n },
          { accountCode: "1000", side: "credit", amountMinor: RS_50_000 },
        ],
      })
    ).toEqual({ ok: false, error: "unbalanced" });
    expect(
      await h.as(finance.actor).createManualEntry({
        ...expenseEntry("2027-01-10", RS_50_000 * 2n),
        lines: [
          { accountCode: "5999", side: "debit", amountMinor: RS_50_000 * 2n },
          { accountCode: "1000", side: "credit", amountMinor: RS_50_000 * 2n },
        ],
      })
    ).toEqual({ ok: false, error: "unknown_account" });
    expect(await requestRows(h)).toEqual([]);
  });

  it("are refused at approval when their month has been locked meanwhile, and stay pending", async () => {
    const h = await createHarness();
    const { requester, approver } = await twoFinanceUsers(h);
    const asked = await h
      .as(requester.actor)
      .createManualEntry(expenseEntry("2026-12-20", RS_50_000 * 3n));
    if (!asked.ok || asked.status !== "pending_approval")
      throw new Error(JSON.stringify(asked));
    const lock = await h
      .as(approver.actor)
      .requestPeriodLock({ month: "2026-12" });
    if (!lock.ok) throw new Error(JSON.stringify(lock));
    await h.as(requester.actor).approveFinanceRequest({
      requestId: lock.requestId,
    });

    expect(
      await h
        .as(approver.actor)
        .approveFinanceRequest({ requestId: asked.requestId })
    ).toEqual({ ok: false, error: "period_locked" });
    expect(await requestRow(h, asked.requestId)).toMatchObject({
      status: "pending",
      executedPostingId: null,
    });
    expect(await postingRows(h)).toEqual([]);
  });

  it("are refused straight away when aimed at a locked month", async () => {
    const h = await createHarness();
    const { requester, approver } = await twoFinanceUsers(h);
    const lock = await h
      .as(approver.actor)
      .requestPeriodLock({ month: "2026-12" });
    if (!lock.ok) throw new Error(JSON.stringify(lock));
    await h.as(requester.actor).approveFinanceRequest({
      requestId: lock.requestId,
    });
    expect(
      await h
        .as(requester.actor)
        .createManualEntry(expenseEntry("2026-12-20", RS_50_000 * 3n))
    ).toEqual({ ok: false, error: "period_locked" });
    expect(
      (await requestRows(h)).filter((row) => row.operation === "manual_entry")
    ).toEqual([]);
  });
});
