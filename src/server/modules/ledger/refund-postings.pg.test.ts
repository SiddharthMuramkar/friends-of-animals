import { randomInt, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";

import {
  auditLog,
  ledgerPosting,
  paymentBatch,
  refund,
} from "@/server/db/schema";
import { createPgWorld, type PgWorld } from "@/test/pg";

async function capturedBatchWithRefunds(world: PgWorld) {
  const batchId = randomUUID();
  const letters = Array.from({ length: 6 }, () =>
    String.fromCharCode(65 + randomInt(26))
  ).join("");
  const now = world.clock.now();
  const competition = await world.seed.competition({
    code: `${letters}27`,
    name: `Ledger refund race ${letters}`,
  });
  const gatewayPaymentId = `pay_${batchId}`;
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
    capturedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const refunds = [30_000n, 70_000n].map((amountMinor) => ({
    id: randomUUID(),
    amountMinor,
  }));
  await world.db.insert(refund).values(
    refunds.map(({ id, amountMinor }) => ({
      id,
      batchId,
      gatewayPaymentId,
      gatewayRefundId: `refund_${id}`,
      kind: "discretionary" as const,
      status: "refunded" as const,
      method: "gateway" as const,
      amountMinor,
      reason: "Two partial refunds of one test capture",
      requestedAt: now,
      decidedAt: now,
      refundedAt: now,
      updatedAt: now,
    }))
  );
  return { batchId, gatewayPaymentId, refunds };
}

it("serializes two partial refund deliveries and books each with one audit", async () => {
  const world = createPgWorld();
  try {
    const { batchId, refunds } = await capturedBatchWithRefunds(world);
    const worker = world.as({ kind: "system", process: "worker" });
    const capture = await worker.postPaymentCapture({ batchId });
    if (capture.outcome !== "posted") throw new Error("Capture was not posted");

    const blocker = await world.sql.reserve();
    try {
      await blocker`begin`;
      await blocker`select id from ledger_posting where id = ${capture.postingId} for no key update`;
      const attempts = Promise.allSettled(
        refunds.map(({ id }) => worker.postRefund({ refundId: id }))
      );
      await world.waitForLockWaiters(2);
      await blocker`commit`;
      expect(await attempts).toMatchObject([
        { status: "fulfilled", value: { outcome: "posted" } },
        { status: "fulfilled", value: { outcome: "posted" } },
      ]);
    } finally {
      await blocker`rollback`.finally(() => blocker.release());
    }

    const postings = await world.db
      .select({ id: ledgerPosting.id, sourceId: ledgerPosting.sourceId })
      .from(ledgerPosting)
      .where(
        and(
          eq(ledgerPosting.reversalOfPostingId, capture.postingId),
          eq(ledgerPosting.sourceType, "refund")
        )
      );
    expect(postings.map(({ sourceId }) => sourceId).sort()).toEqual(
      refunds.map(({ id }) => id).sort()
    );
    const audits = await world.db
      .select({ id: auditLog.entityId, after: auditLog.after })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "ledger.posting_created"),
          inArray(
            auditLog.entityId,
            postings.map(({ id }) => id)
          )
        )
      );
    expect(audits.map(({ id }) => id).sort()).toEqual(
      postings.map(({ id }) => id).sort()
    );
    for (const { id, amountMinor } of refunds) {
      expect(audits).toContainEqual(
        expect.objectContaining({
          after: expect.objectContaining({
            sourceId: id,
            totalMinor: amountMinor.toString(),
          }),
        })
      );
    }
  } finally {
    await world.close();
  }
});

it("books one missing capture when two refunds arrive before its delivery", async () => {
  const world = createPgWorld();
  try {
    const { batchId, gatewayPaymentId, refunds } =
      await capturedBatchWithRefunds(world);
    const worker = world.as({ kind: "system", process: "worker" });

    const blocker = await world.sql.reserve();
    try {
      await blocker`begin`;
      // Let both deliveries read the journal, then release their inserts together.
      await blocker`lock table ledger_posting in share mode`;
      expect(
        await blocker`select id from ledger_posting where source_id = ${gatewayPaymentId}`
      ).toEqual([]);
      const attempts = Promise.allSettled(
        refunds.map(({ id }) => worker.postRefund({ refundId: id }))
      );
      await world.waitForLockWaiters(2);
      await blocker`commit`;
      expect(await attempts).toMatchObject([
        { status: "fulfilled", value: { outcome: "posted" } },
        { status: "fulfilled", value: { outcome: "posted" } },
      ]);
    } finally {
      await blocker`rollback`.finally(() => blocker.release());
    }

    const sourceIds = [gatewayPaymentId, ...refunds.map(({ id }) => id)];
    const readJournal = async () => {
      const postings = await world.db
        .select()
        .from(ledgerPosting)
        .where(inArray(ledgerPosting.sourceId, sourceIds))
        .orderBy(ledgerPosting.seq);
      const audits = await world.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "ledger.posting_created"),
            inArray(
              auditLog.entityId,
              postings.map(({ id }) => id)
            )
          )
        )
        .orderBy(auditLog.id);
      return { postings, audits };
    };
    const journal = await readJournal();
    expect(journal.postings).toHaveLength(3);
    const [capture, ...reversals] = journal.postings;
    expect(capture).toMatchObject({
      sourceType: "payment_capture",
      sourceId: gatewayPaymentId,
    });
    expect(reversals).toEqual(
      expect.arrayContaining(
        refunds.map(({ id }) =>
          expect.objectContaining({
            sourceType: "refund",
            sourceId: id,
            reversalOfPostingId: capture!.id,
          })
        )
      )
    );
    expect(journal.audits.map(({ entityId }) => entityId).sort()).toEqual(
      journal.postings.map(({ id }) => id).sort()
    );

    expect(await worker.postPaymentCapture({ batchId })).toMatchObject({
      outcome: "duplicate",
      postingId: capture!.id,
    });
    expect(await readJournal()).toEqual(journal);
  } finally {
    await world.close();
  }
});
