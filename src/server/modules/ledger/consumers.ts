import { and, eq, sum } from "drizzle-orm";

import { authorize, type PolicyContext } from "../../access/can";
import type { AppDb } from "../../db/app-db";
import { ledgerLine, ledgerPosting, paymentBatch } from "../../db/schema";

import { postingDescription } from "./descriptions";
import { fromColumns } from "./domain/posting";
import {
  donationCaptureLines,
  foreignDonationLines,
  refundLines,
  registrationCaptureLines,
} from "./domain/posting-rules";
import { findSourcePosting, postToLedger, type PostedEntry } from "./post";
import { postingLines } from "./rows";
import {
  donationOfBatch,
  readDonation,
  readForeignDonation,
  type DonationFact,
  type ForeignDonationFact,
} from "./sources/donations";
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

/** A captured donation (#106): one posting, Dr clearing / Cr donations. */
export async function postDonation(
  ctx: PolicyContext,
  { donationId }: { donationId: string }
) {
  await authorize(ctx, "ledger.post_payment");
  return ctx.db.transaction(async (tx) => {
    const fact = await readDonation(tx, donationId);
    if (!fact) return { outcome: "ignored" } as const;
    return postDonationFact(tx, ctx, fact);
  });
}

function postDonationFact(tx: AppDb, ctx: PolicyContext, fact: DonationFact) {
  return postToLedger(tx, ctx, {
    source: fact.source,
    occurredAt: fact.occurredAt,
    description: postingDescription("donation"),
    lines: donationCaptureLines(fact),
  });
}

/**
 * Foreign money a donation refused (#106): owed back, so Dr clearing /
 * Cr foreign contributions, never income. Its refund reverses it.
 */
export async function postForeignDonation(
  ctx: PolicyContext,
  {
    donationId,
    gatewayPaymentId,
  }: { donationId: string; gatewayPaymentId: string }
) {
  await authorize(ctx, "ledger.post_payment");
  return ctx.db.transaction(async (tx) => {
    const fact = await readForeignDonation(tx, donationId, gatewayPaymentId);
    if (!fact) return { outcome: "ignored" } as const;
    return postForeignFact(tx, ctx, fact);
  });
}

function postForeignFact(
  tx: AppDb,
  ctx: PolicyContext,
  fact: ForeignDonationFact
) {
  return postToLedger(tx, ctx, {
    source: fact.source,
    occurredAt: fact.occurredAt,
    description: postingDescription("foreign_donation"),
    lines: foreignDonationLines(fact),
  });
}

type Returned = NonNullable<Awaited<ReturnType<typeof readProcessedRefund>>>;

/** The posting a refund reverses, posted first if it was missed. */
type Original = {
  posting: PostedEntry;
  competitionId?: string;
  description: "refund" | "donation_refund" | "foreign_refund";
};

async function originalOf(
  tx: AppDb,
  ctx: PolicyContext,
  returned: Returned
): Promise<Original> {
  const [batch] = await tx
    .select({ purpose: paymentBatch.purpose })
    .from(paymentBatch)
    .where(eq(paymentBatch.id, returned.batchId));
  if (batch?.purpose === "donation") {
    const donationId = await donationOfBatch(tx, returned.batchId);
    if (!donationId) throw new Error("Donation refund has no donation");
    if (returned.kind === "foreign_payment") {
      const fact = returned.gatewayPaymentId
        ? await readForeignDonation(tx, donationId, returned.gatewayPaymentId)
        : undefined;
      if (!fact) throw new Error("Foreign refund has no foreign payment");
      return {
        posting: await postForeignFact(tx, ctx, fact),
        description: "foreign_refund",
      };
    }
    const fact = await readDonation(tx, donationId);
    if (!fact) throw new Error("Donation refund has no captured donation");
    if (
      returned.method === "gateway" &&
      returned.gatewayPaymentId !== fact.gatewayPaymentId
    ) {
      throw new Error("Gateway refund does not match the donation's payment");
    }
    return {
      posting: await postDonationFact(tx, ctx, fact),
      description: "donation_refund",
    };
  }

  const fact = await readCapture(tx, returned.batchId);
  if (!fact) throw new Error("Processed refund has no captured batch");
  if (
    returned.method === "gateway" &&
    (fact.source.type !== "payment_capture" ||
      returned.gatewayPaymentId !== fact.source.id)
  ) {
    throw new Error("Gateway refund does not match the captured payment");
  }
  return {
    posting: await postCapture(tx, ctx, fact),
    competitionId: fact.competitionId,
    description: "refund",
  };
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

    const original = await originalOf(tx, ctx, returned);
    const capture = original.posting;
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
      description: postingDescription(original.description),
      ...(original.competitionId
        ? { competitionId: original.competitionId }
        : {}),
      reversalOfPostingId: capture.postingId,
      lines: reversal.lines,
    });
  });
}
