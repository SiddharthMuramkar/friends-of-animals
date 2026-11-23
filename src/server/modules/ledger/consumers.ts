import { and, eq, sum } from "drizzle-orm";

import { authorize, type PolicyContext } from "../../access/can";
import type { AppDb } from "../../db/app-db";
import { ledgerLine, ledgerPosting } from "../../db/schema";

import { postingDescription } from "./descriptions";
import { fromColumns } from "./domain/posting";
import { refundLines, registrationCaptureLines } from "./domain/posting-rules";
import { findSourcePosting, postToLedger } from "./post";
import { postingLines } from "./rows";
import {
  readCapture,
  readProcessedRefund,
  type CaptureFact,
} from "./sources/payments";

export const ledgerWorker = { kind: "system", process: "worker" } as const;

export async function postPaymentCapture(
  ctx: PolicyContext,
  { batchId }: { batchId: string }
) {
  await authorize(ctx, "ledger.post_payment");
  return ctx.db.transaction(async (tx) => {
    const fact = await readCapture(tx, batchId);
    if (!fact) return { outcome: "ignored" } as const;
    return postCapture(tx, ctx, fact);
  });
}

function postCapture(tx: AppDb, ctx: PolicyContext, fact: CaptureFact) {
  return postToLedger(tx, ctx, {
    source: fact.source,
    competitionId: fact.competitionId,
    occurredAt: fact.occurredAt,
    description: postingDescription(fact.source.type),
    lines: registrationCaptureLines(fact),
  });
}

export async function postRefund(
  ctx: PolicyContext,
  { refundId }: { refundId: string }
) {
  await authorize(ctx, "ledger.post_payment");
  return ctx.db.transaction(async (tx) => {
    const source = { type: "refund", id: refundId } as const;
    const previous = await findSourcePosting(tx, source);
    if (previous) return { outcome: "duplicate", ...previous } as const;

    const returned = await readProcessedRefund(tx, refundId);
    if (!returned) return { outcome: "ignored" } as const;

    const fact = await readCapture(tx, returned.batchId);
    if (!fact) throw new Error("Processed refund has no captured batch");
    if (
      returned.method === "gateway" &&
      (fact.source.type !== "payment_capture" ||
        returned.gatewayPaymentId !== fact.source.id)
    ) {
      throw new Error("Gateway refund does not match the captured payment");
    }

    const capture = await postCapture(tx, ctx, fact);
    // Serialize refunds of this capture even when the outbox and reconcile
    // job run together. The lock permits the reversal's foreign key check.
    await tx
      .select({ id: ledgerPosting.id })
      .from(ledgerPosting)
      .where(eq(ledgerPosting.id, capture.postingId))
      .for("no key update");
    const concurrent = await findSourcePosting(tx, source);
    if (concurrent) return { outcome: "duplicate", ...concurrent } as const;

    const originalLines = await postingLines(tx, capture.postingId);
    const [earlier] = await tx
      .select({ total: sum(ledgerLine.debitMinor) })
      .from(ledgerLine)
      .innerJoin(ledgerPosting, eq(ledgerPosting.id, ledgerLine.postingId))
      .where(
        and(
          eq(ledgerPosting.reversalOfPostingId, capture.postingId),
          eq(ledgerPosting.sourceType, "refund")
        )
      );

    const reversal = refundLines({
      capture: originalLines.map(fromColumns),
      amountMinor: returned.amountMinor,
      alreadyRefundedMinor: BigInt(earlier?.total ?? 0),
      ...(returned.manualMethod ? { method: returned.manualMethod } : {}),
    });
    if (!reversal.ok)
      throw new Error(`Ledger refund refused: ${reversal.error}`);
    return postToLedger(tx, ctx, {
      source,
      occurredAt: returned.occurredAt,
      description: postingDescription("refund"),
      competitionId: fact.competitionId,
      reversalOfPostingId: capture.postingId,
      lines: reversal.lines,
    });
  });
}
