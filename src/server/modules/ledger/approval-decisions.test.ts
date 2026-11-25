import { describe, expect, it } from "vitest";

import { SCHEDULES } from "@/server/outbox/schedules";
import { createHarness, type Harness } from "@/test/harness";

import {
  ledgerAudit,
  periodRow,
  requestRow,
  signInAgain,
  signInAs,
  twoFinanceUsers,
  type Staff,
} from "./testing";

// #109: what can happen to a two-approver request besides approval. A
// different finance user rejects it with a reason; only the requester
// cancels it; after `ledger.approvalExpiryDays` it expires, and the daily
// job marks it so. A request that is no longer pending refuses everything.

async function pendingLock(h: Harness, requester: Staff, month = "2026-12") {
  const requested = await h.as(requester.actor).requestPeriodLock({ month });
  if (!requested.ok) throw new Error(JSON.stringify(requested));
  return requested.requestId;
}

const expireJob = SCHEDULES.find(
  ({ name }) => name === "ledger.expire_approvals"
)!;

describe("rejecting a request", () => {
  it("needs a different finance user and a reason, and is audited without the reason", async () => {
    const h = await createHarness();
    const { requester, approver } = await twoFinanceUsers(h);
    const requestId = await pendingLock(h, requester);

    expect(
      await h
        .as(requester.actor)
        .rejectFinanceRequest({ requestId, reason: "Not yet" })
    ).toEqual({ ok: false, error: "self_approval" });
    expect(
      await h
        .as(approver.actor)
        .rejectFinanceRequest({ requestId, reason: " " })
    ).toEqual({ ok: false, error: "reason_required" });

    // Rejecting moves no money, so a stale second factor is enough.
    h.clock.advance({ minutes: 30 });
    expect(
      await h
        .as(approver.actor)
        .rejectFinanceRequest({ requestId, reason: "Bank statement missing" })
    ).toEqual({ ok: true, status: "rejected" });
    expect(await requestRow(h, requestId)).toMatchObject({
      status: "rejected",
      decidedByUserId: approver.userId,
      decisionReason: "Bank statement missing",
    });
    expect(await periodRow(h, "2026-12")).toBeUndefined();
    const rejected = (await ledgerAudit(h)).at(-1);
    expect(rejected).toMatchObject({
      action: "ledger.approval_rejected",
      actorUserId: approver.userId,
      entityId: requestId,
      after: { operation: "period_lock", status: "rejected" },
    });
    expect(JSON.stringify(rejected)).not.toContain("Bank statement");
  });
});

describe("cancelling a request", () => {
  it("is for the requester only, and is audited", async () => {
    const h = await createHarness();
    const { requester, approver } = await twoFinanceUsers(h);
    const requestId = await pendingLock(h, requester);

    expect(
      await h.as(approver.actor).cancelFinanceRequest({ requestId })
    ).toEqual({ ok: false, error: "not_requester" });
    expect(
      await h.as(requester.actor).cancelFinanceRequest({ requestId })
    ).toEqual({ ok: true, status: "cancelled" });
    expect(await requestRow(h, requestId)).toMatchObject({
      status: "cancelled",
      decidedByUserId: requester.userId,
    });
    expect((await ledgerAudit(h)).at(-1)).toMatchObject({
      action: "ledger.approval_cancelled",
      actorUserId: requester.userId,
      entityId: requestId,
    });
  });
});

describe("a request nobody decides", () => {
  it("can't be approved, rejected or cancelled once its window has passed, and the daily job expires it", async () => {
    const h = await createHarness();
    const first = await twoFinanceUsers(h);
    const requestId = await pendingLock(h, first.requester);
    expect(await requestRow(h, requestId)).toMatchObject({
      expiresAt: new Date(h.clock.now().getTime() + 7 * 24 * 3600 * 1000),
    });

    h.clock.advance({ days: 7 });
    const requester = await signInAgain(h, first.requester);
    const approver = await signInAgain(h, first.approver);
    expect(
      await h.as(approver.actor).approveFinanceRequest({ requestId })
    ).toEqual({ ok: false, error: "request_expired" });
    expect(
      await h
        .as(approver.actor)
        .rejectFinanceRequest({ requestId, reason: "Late" })
    ).toEqual({ ok: false, error: "request_expired" });
    expect(
      await h.as(requester.actor).cancelFinanceRequest({ requestId })
    ).toEqual({ ok: false, error: "request_expired" });
    // Finance can ask again while the old one waits for the job.
    expect(
      await h.as(requester.actor).requestPeriodLock({ month: "2026-12" })
    ).toMatchObject({ ok: true });

    await expireJob.run(h.deps);
    expect(await requestRow(h, requestId)).toMatchObject({
      status: "expired",
      decidedByUserId: null,
      decidedAt: h.clock.now(),
    });
    expect((await ledgerAudit(h)).at(-1)).toMatchObject({
      action: "ledger.approval_expired",
      actorKind: "system",
      actorProcess: "worker",
      entityId: requestId,
      before: { operation: "period_lock", status: "pending" },
      after: { operation: "period_lock", status: "expired" },
    });
  });

  it("is left alone by the job before its window passes", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    const requestId = await pendingLock(h, finance);
    h.clock.advance({ days: 6, hours: 23 });
    expect(
      await h.as({ kind: "system", process: "worker" }).expireFinanceRequests()
    ).toEqual({ expired: 0 });
    expect(await requestRow(h, requestId)).toMatchObject({ status: "pending" });
  });

  it("takes its window from the setting when it was made", async () => {
    const h = await createHarness();
    await h.settings.set("ledger.approvalExpiryDays", 2);
    const finance = await signInAs(h);
    const requestId = await pendingLock(h, finance);
    await h.settings.set("ledger.approvalExpiryDays", 30);
    h.clock.advance({ days: 2 });
    expect(
      await h.as({ kind: "system", process: "cli" }).expireFinanceRequests()
    ).toEqual({ expired: 1 });
    expect(await requestRow(h, requestId)).toMatchObject({ status: "expired" });
  });
});

describe("a request that is no longer pending", () => {
  it.each(["approved", "rejected", "cancelled"] as const)(
    "refuses every decision once %s",
    async (status) => {
      const h = await createHarness();
      const { requester, approver } = await twoFinanceUsers(h);
      const requestId = await pendingLock(h, requester);
      const decide = {
        approved: () =>
          h.as(approver.actor).approveFinanceRequest({ requestId }),
        rejected: () =>
          h
            .as(approver.actor)
            .rejectFinanceRequest({ requestId, reason: "No" }),
        cancelled: () =>
          h.as(requester.actor).cancelFinanceRequest({ requestId }),
      };
      expect(await decide[status]()).toMatchObject({ ok: true, status });

      for (const again of Object.values(decide)) {
        expect(await again()).toEqual({ ok: false, error: "not_pending" });
      }
    }
  );

  it("answers not_found for an unknown or malformed request id", async () => {
    const h = await createHarness();
    const { approver } = await twoFinanceUsers(h);
    for (const requestId of [
      "01938a00-0000-7000-8000-000000000000",
      "not-a-uuid",
    ]) {
      expect(
        await h.as(approver.actor).approveFinanceRequest({ requestId })
      ).toEqual({ ok: false, error: "not_found" });
    }
  });
});

describe("listing requests", () => {
  it("shows each finance user what they may do: approve or reject others' requests, cancel their own", async () => {
    const h = await createHarness();
    const { requester, approver } = await twoFinanceUsers(h);
    const lockId = await pendingLock(h, requester, "2026-12");
    const unlockable = await pendingLock(h, approver, "2026-11");
    await h
      .as(requester.actor)
      .approveFinanceRequest({ requestId: unlockable });

    const mine = await h.as(requester.actor).listFinanceRequests();
    expect(mine.pending).toEqual([
      expect.objectContaining({
        id: lockId,
        operation: "period_lock",
        requesterName: requester.name,
        mine: true,
        canApprove: false,
        canReject: false,
        canCancel: true,
        summary: { kind: "period_lock", month: "2026-12", reason: null },
      }),
    ]);
    expect(mine.decided).toEqual([
      expect.objectContaining({
        id: unlockable,
        status: "approved",
        requesterName: approver.name,
        deciderName: requester.name,
        canApprove: false,
        canCancel: false,
      }),
    ]);
    const theirs = await h.as(approver.actor).listFinanceRequests();
    expect(theirs.pending).toEqual([
      expect.objectContaining({
        id: lockId,
        mine: false,
        canApprove: true,
        canReject: true,
        canCancel: false,
      }),
    ]);
  });
});

describe("decision authorization", () => {
  it.each(["staff_admin", "super_admin", "competition_manager", null] as const)(
    "refuses a %s who doesn't hold finance",
    async (role) => {
      const h = await createHarness();
      const finance = await signInAs(h);
      const requestId = await pendingLock(h, finance);
      const other = await signInAs(h, role);
      for (const call of [
        () => h.as(other.actor).listFinanceRequests(),
        () =>
          h.as(other.actor).rejectFinanceRequest({ requestId, reason: "No" }),
        () => h.as(other.actor).cancelFinanceRequest({ requestId }),
        () => h.as(other.actor).expireFinanceRequests(),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: "forbidden" });
      }
      expect(await requestRow(h, requestId)).toMatchObject({
        status: "pending",
      });
    }
  );

  it("runs the expiry only as the platform, not as finance or a visitor", async () => {
    const h = await createHarness();
    const finance = await signInAs(h);
    await expect(
      h.as(finance.actor).expireFinanceRequests()
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as(h.visitor()).expireFinanceRequests()
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await h.as({ kind: "system", process: "worker" }).expireFinanceRequests()
    ).toEqual({ expired: 0 });
  });
});
