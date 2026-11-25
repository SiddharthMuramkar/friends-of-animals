import { randomInt, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { expect, it } from "vitest";

import {
  financeApproval,
  ledgerPeriod,
  ledgerPosting,
  paymentBatch,
} from "@/server/db/schema";
import { createPgWorld, type PgWorld } from "@/test/pg";

import { nextPeriodMonth, periodStart } from "./domain/period";

// #109 on real Postgres: a lock approved while a posting into the same
// month is in flight waits for that posting (the posting holds ROW
// EXCLUSIVE on ledger_period from before it reads the lock line; the lock
// needs SHARE ROW EXCLUSIVE), so the posting either counts in the month
// before it locks or reads the new lock line. If the lock didn't wait, it
// would commit first and the trigger would refuse the capture outright.
//
// The test database is shared and keeps its rows, and locked months must
// stay a prefix, so each run locks the month after the last run's, far in
// the past where no other test posts. Other test files may also seed a
// pending lock request; advance this world's fake clock past it before
// requesting our own lock, rather than changing another test's fixture.

async function nextUnlockedMonth(world: PgWorld) {
  const [pending] = await world.db
    .select({ expiresAt: financeApproval.expiresAt })
    .from(financeApproval)
    .where(
      and(
        eq(financeApproval.operation, "period_lock"),
        eq(financeApproval.status, "pending")
      )
    )
    .orderBy(desc(financeApproval.expiresAt))
    .limit(1);
  if (pending && pending.expiresAt > world.clock.now()) {
    world.clock.set(pending.expiresAt);
  }

  const [latest] = await world.db
    .select({ month: ledgerPeriod.month })
    .from(ledgerPeriod)
    .where(eq(ledgerPeriod.status, "locked"))
    .orderBy(desc(ledgerPeriod.month))
    .limit(1);
  return latest ? nextPeriodMonth(latest.month) : "2001-01";
}

async function financeUser(world: PgWorld) {
  const user = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(user, { role: "finance", scope: { type: "global" } });
  await world.seed.authenticator(user);
  return world.signedIn(user, { secondFactor: true });
}

async function captureIn(world: PgWorld, month: string) {
  const batchId = randomUUID();
  const letters = Array.from({ length: 6 }, () =>
    String.fromCharCode(65 + randomInt(26))
  ).join("");
  const competition = await world.seed.competition({
    code: `${letters}27`,
    name: `Period lock race ${letters}`,
  });
  const capturedAt = new Date(periodStart(month).getTime() + 86_400_000);
  const gatewayPaymentId = `pay_${batchId}`;
  const now = world.clock.now();
  await world.db.insert(paymentBatch).values({
    id: batchId,
    competitionId: competition.id,
    route: "individual",
    status: "captured",
    amountMinor: 100_000n,
    gateway: "fake",
    gatewayOrderId: `order_${batchId}`,
    gatewayPaymentId,
    captureMethod: "gateway",
    capturedAt,
    createdAt: now,
    updatedAt: now,
  });
  return { batchId, gatewayPaymentId };
}

it("makes a lock approval wait for a capture already posting into that month, then locks it with the capture inside", async () => {
  const world = createPgWorld();
  try {
    const month = await nextUnlockedMonth(world);
    const requester = await financeUser(world);
    const approver = await financeUser(world);
    const requested = await world.as(requester).requestPeriodLock({ month });
    if (!requested.ok) throw new Error(JSON.stringify(requested));
    const { batchId, gatewayPaymentId } = await captureIn(world, month);

    // Another request holds the capture's journal key uncommitted, so the
    // capture pauses after it has read the lock line and claimed its month.
    const blocker = await world.sql.reserve();
    try {
      await blocker`begin`;
      await blocker`
        insert into ledger_posting
          (id, source_type, source_id, occurred_at, period_month,
           description, expected_line_count, created_at)
        values (${randomUUID()}, 'payment_capture', ${gatewayPaymentId},
                now(), ${month}, 'Blocking test posting', 2, now())`;
      const capture = world
        .as({ kind: "system", process: "worker" })
        .postPaymentCapture({ batchId });
      await world.waitForLockWaiters(1);
      const approval = world
        .as(approver)
        .approveFinanceRequest({ requestId: requested.requestId });
      await world.waitForLockWaiters(2);
      await blocker`rollback`;

      const [captured, approved] = await Promise.allSettled([
        capture,
        approval,
      ]);
      expect(captured).toMatchObject({
        status: "fulfilled",
        value: { outcome: "posted" },
      });
      expect(approved).toMatchObject({
        status: "fulfilled",
        value: { ok: true, status: "approved" },
      });
    } finally {
      blocker.release();
    }

    const [posting] = await world.db
      .select({ periodMonth: ledgerPosting.periodMonth })
      .from(ledgerPosting)
      .where(
        and(
          eq(ledgerPosting.sourceType, "payment_capture"),
          eq(ledgerPosting.sourceId, gatewayPaymentId)
        )
      );
    expect(posting).toEqual({ periodMonth: month });
    const [period] = await world.db
      .select({ status: ledgerPeriod.status })
      .from(ledgerPeriod)
      .where(eq(ledgerPeriod.month, month));
    expect(period).toEqual({ status: "locked" });
  } finally {
    await world.close();
  }
});

it("sends a capture for a month locked before it posts past the lock line", async () => {
  const world = createPgWorld();
  try {
    const month = await nextUnlockedMonth(world);
    const requester = await financeUser(world);
    const approver = await financeUser(world);
    const requested = await world.as(requester).requestPeriodLock({ month });
    if (!requested.ok) throw new Error(JSON.stringify(requested));
    const { batchId, gatewayPaymentId } = await captureIn(world, month);
    expect(
      await world
        .as(approver)
        .approveFinanceRequest({ requestId: requested.requestId })
    ).toMatchObject({ ok: true });

    expect(
      await world
        .as({ kind: "system", process: "worker" })
        .postPaymentCapture({ batchId })
    ).toMatchObject({ outcome: "posted" });
    const [posting] = await world.db
      .select({ periodMonth: ledgerPosting.periodMonth })
      .from(ledgerPosting)
      .where(eq(ledgerPosting.sourceId, gatewayPaymentId));
    expect(posting).toEqual({ periodMonth: nextPeriodMonth(month) });
  } finally {
    await world.close();
  }
});
