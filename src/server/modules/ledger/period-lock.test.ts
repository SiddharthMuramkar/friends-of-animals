import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";

import {
  expenseEntry,
  ledgerAudit,
  periodRow,
  requestRow,
  requestRows,
  signInAs,
  stepUp,
  twoFinanceUsers,
  type Staff,
} from "./testing";

// #109 unit 109a: finance locks a reconciled month, and a second,
// different finance user approves the lock behind a fresh second factor.
// The harness clock starts on 15 January 2027 (IST), so December 2026 is
// the latest month that has ended and January 2027 is the current one.

async function lockedThrough(
  h: Harness,
  months: string[],
  users?: {
    requester: Staff;
    approver: Staff;
  }
) {
  const { requester, approver } = users ?? (await twoFinanceUsers(h));
  for (const month of months) {
    const requested = await h.as(requester.actor).requestPeriodLock({ month });
    if (!requested.ok) throw new Error(JSON.stringify(requested));
    const approved = await h
      .as(approver.actor)
      .approveFinanceRequest({ requestId: requested.requestId });
    if (!approved.ok) throw new Error(JSON.stringify(approved));
  }
  return { requester, approver };
}

describe("requesting and approving a period lock", () => {
  it("waits for a second finance user, refuses self-approval and a stale second factor, then locks in the approver's transaction", async () => {
    const h = await createHarness();
    const { requester, approver } = await twoFinanceUsers(h);
    await h
      .as(requester.actor)
      .createManualEntry(expenseEntry("2026-12-10", 10_000n));

    const requested = await h
      .as(requester.actor)
      .requestPeriodLock({ month: "2026-12" });
    expect(requested).toEqual({ ok: true, requestId: expect.any(String) });
    if (!requested.ok) return;
    expect(await requestRow(h, requested.requestId)).toMatchObject({
      operation: "period_lock",
      status: "pending",
      requestedByUserId: requester.userId,
      payload: { month: "2026-12" },
    });
    expect(await periodRow(h, "2026-12")).toMatchObject({ status: "open" });

    expect(
      await h
        .as(requester.actor)
        .approveFinanceRequest({ requestId: requested.requestId })
    ).toEqual({ ok: false, error: "self_approval" });

    h.clock.advance({ minutes: 10, seconds: 1 });
    await expect(
      h
        .as(approver.actor)
        .approveFinanceRequest({ requestId: requested.requestId })
    ).rejects.toMatchObject({ code: "step_up_required" });
    expect(await periodRow(h, "2026-12")).toMatchObject({ status: "open" });

    await stepUp(h, approver);
    expect(
      await h
        .as(approver.actor)
        .approveFinanceRequest({ requestId: requested.requestId })
    ).toEqual({ ok: true, status: "approved" });
    expect(await periodRow(h, "2026-12")).toMatchObject({
      status: "locked",
      lockedAt: h.clock.now(),
      lockedByUserId: approver.userId,
    });
    expect(await requestRow(h, requested.requestId)).toMatchObject({
      status: "approved",
      decidedByUserId: approver.userId,
      decidedAt: h.clock.now(),
    });
  });

  it("audits the request, the approval and the lock with ids and statuses only", async () => {
    const h = await createHarness();
    const { requester, approver } = await lockedThrough(h, ["2026-12"]);
    const [request] = await requestRows(h);

    const logged = (await ledgerAudit(h)).map(
      ({
        action,
        actorUserId,
        actorRole,
        entityType,
        entityId,
        before,
        after,
      }) => ({
        action,
        actorUserId,
        actorRole,
        entityType,
        entityId,
        before,
        after,
      })
    );
    expect(logged).toEqual([
      {
        action: "ledger.approval_requested",
        actorUserId: requester.userId,
        actorRole: "finance",
        entityType: "finance_approval",
        entityId: request!.id,
        before: null,
        after: {
          operation: "period_lock",
          status: "pending",
          month: "2026-12",
        },
      },
      {
        action: "ledger.approval_approved",
        actorUserId: approver.userId,
        actorRole: "finance",
        entityType: "finance_approval",
        entityId: request!.id,
        before: { operation: "period_lock", status: "pending" },
        after: { operation: "period_lock", status: "approved" },
      },
      {
        action: "ledger.period_locked",
        actorUserId: approver.userId,
        actorRole: "finance",
        entityType: "ledger_period",
        entityId: "2026-12",
        before: { status: null },
        after: { status: "locked", requestId: request!.id },
      },
    ]);
  });

  it("lists the periods with the lock line, each month's status and its pending request", async () => {
    const h = await createHarness();
    const { requester } = await lockedThrough(h, ["2026-11"]);
    await h
      .as(requester.actor)
      .createManualEntry(expenseEntry("2026-12-03", 5_000n));
    const pending = await h
      .as(requester.actor)
      .requestPeriodLock({ month: "2026-12" });
    if (!pending.ok) throw new Error(JSON.stringify(pending));

    const view = await h.as(requester.actor).listLedgerPeriods();
    expect(view).toMatchObject({
      currentMonth: "2027-01",
      lockLine: "2026-11",
    });
    expect(view.periods.map(({ month, status }) => [month, status])).toEqual([
      ["2027-01", "open"],
      ["2026-12", "open"],
      ["2026-11", "locked"],
    ]);
    expect(view.periods[1]).toMatchObject({
      pendingRequest: {
        requestId: pending.requestId,
        operation: "period_lock",
      },
      canRequestLock: false,
      canRequestUnlock: false,
    });
    expect(view.periods[0]).toMatchObject({
      canRequestLock: false,
      pendingRequest: null,
    });
    expect(view.periods[2]).toMatchObject({ canRequestUnlock: true });
  });
});

describe("which months can be locked", () => {
  it("refuses a month that hasn't begun, but lets finance lock the current month early", async () => {
    const h = await createHarness();
    const { requester } = await lockedThrough(h, ["2026-12"]);
    expect(
      await h.as(requester.actor).requestPeriodLock({ month: "2027-02" })
    ).toEqual({ ok: false, error: "period_not_started" });
    expect(
      await h.as(requester.actor).requestPeriodLock({ month: "2027-01" })
    ).toEqual({ ok: true, requestId: expect.any(String) });
  });

  it("refuses a month on or before the lock line", async () => {
    const h = await createHarness();
    const { requester } = await lockedThrough(h, ["2026-12"]);
    for (const month of ["2026-12", "2026-06"]) {
      expect(await h.as(requester.actor).requestPeriodLock({ month })).toEqual({
        ok: false,
        error: "period_locked",
      });
    }
  });

  it("refuses to skip an earlier month that has postings", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    await h
      .as(finance.actor)
      .createManualEntry(expenseEntry("2026-11-20", 2_000n));
    expect(
      await h.as(finance.actor).requestPeriodLock({ month: "2026-12" })
    ).toEqual({ ok: false, error: "earlier_period_open", month: "2026-11" });
  });

  it("keeps one pending request per month and operation", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    await h.as(finance.actor).requestPeriodLock({ month: "2026-12" });
    expect(
      await h.as(finance.actor).requestPeriodLock({ month: "2026-12" })
    ).toEqual({ ok: false, error: "request_pending" });
  });

  it.each(["2026-13", "2026-1", "", "december"])(
    "refuses %j as a month",
    async (month) => {
      const h = await createHarness();
      const finance = await signInAs(h);
      expect(await h.as(finance.actor).requestPeriodLock({ month })).toEqual({
        ok: false,
        error: "invalid_input",
      });
    }
  );

  it("checks the rule again at approval: a request whose month became unlockable stays pending", async () => {
    const h = await createHarness();
    const { requester, approver } = await twoFinanceUsers(h);
    const december = await h
      .as(requester.actor)
      .requestPeriodLock({ month: "2026-12" });
    if (!december.ok) throw new Error(JSON.stringify(december));
    // November gains a posting after the request: December would skip it.
    await h
      .as(requester.actor)
      .createManualEntry(expenseEntry("2026-11-30", 1_000n));

    expect(
      await h
        .as(approver.actor)
        .approveFinanceRequest({ requestId: december.requestId })
    ).toEqual({ ok: false, error: "earlier_period_open", month: "2026-11" });
    expect(await requestRow(h, december.requestId)).toMatchObject({
      status: "pending",
    });
    expect(await periodRow(h, "2026-12")).toBeUndefined();
  });
});

describe("unlocking a period", () => {
  it("needs a reason, only reopens the latest locked month, and records who and why", async () => {
    const h = await createHarness();
    const { requester, approver } = await lockedThrough(h, [
      "2026-11",
      "2026-12",
    ]);

    expect(
      await h
        .as(requester.actor)
        .requestPeriodUnlock({ month: "2026-12", reason: "   " })
    ).toEqual({ ok: false, error: "invalid_input" });
    expect(
      await h
        .as(requester.actor)
        .requestPeriodUnlock({ month: "2026-11", reason: "Bank fee missed" })
    ).toEqual({ ok: false, error: "later_period_locked", month: "2026-12" });
    expect(
      await h
        .as(requester.actor)
        .requestPeriodUnlock({ month: "2027-01", reason: "Bank fee missed" })
    ).toEqual({ ok: false, error: "period_not_locked" });

    const unlock = await h
      .as(requester.actor)
      .requestPeriodUnlock({ month: "2026-12", reason: "Bank fee missed" });
    if (!unlock.ok) throw new Error(JSON.stringify(unlock));
    await stepUp(h, approver);
    expect(
      await h
        .as(approver.actor)
        .approveFinanceRequest({ requestId: unlock.requestId })
    ).toEqual({ ok: true, status: "approved" });

    expect(await periodRow(h, "2026-12")).toMatchObject({
      status: "open",
      lockedAt: null,
      lockedByUserId: null,
      lastUnlockedAt: h.clock.now(),
      lastUnlockedByUserId: approver.userId,
      lastUnlockReason: "Bank fee missed",
    });
    expect(await periodRow(h, "2026-11")).toMatchObject({ status: "locked" });
    const unlocked = (await ledgerAudit(h)).find(
      ({ action }) => action === "ledger.period_unlocked"
    );
    expect(unlocked).toMatchObject({
      actorUserId: approver.userId,
      entityId: "2026-12",
      before: { status: "locked" },
      after: { status: "open", requestId: unlock.requestId },
    });
    expect(JSON.stringify(unlocked)).not.toContain("Bank fee missed");
  });
});

describe("period lock authorization", () => {
  it.each(["staff_admin", "super_admin", "competition_manager", null] as const)(
    "refuses a %s who doesn't hold finance, and writes nothing",
    async (role) => {
      const h = await createHarness();
      const finance = await signInAs(h);
      const requested = await h
        .as(finance.actor)
        .requestPeriodLock({ month: "2026-12" });
      if (!requested.ok) throw new Error(JSON.stringify(requested));
      const other = await signInAs(h, role);
      const before = await ledgerAudit(h);

      for (const call of [
        () => h.as(other.actor).listLedgerPeriods(),
        () => h.as(other.actor).requestPeriodLock({ month: "2026-12" }),
        () =>
          h
            .as(other.actor)
            .requestPeriodUnlock({ month: "2026-12", reason: "Because" }),
        () =>
          h
            .as(other.actor)
            .approveFinanceRequest({ requestId: requested.requestId }),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: "forbidden" });
      }
      expect(await ledgerAudit(h)).toEqual(before);
    }
  );

  it("refuses a visitor", async () => {
    const h = await createHarness();
    await expect(
      h.as(h.visitor()).requestPeriodLock({ month: "2026-12" })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.as(h.visitor()).listLedgerPeriods()).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
