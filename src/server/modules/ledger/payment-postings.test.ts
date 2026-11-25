import { and, eq, like, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { messages } from "@/i18n/messages";
import {
  auditLog,
  ledgerAccount,
  ledgerLine,
  ledgerPosting,
  outbox,
  paymentBatch,
  refund,
} from "@/server/db/schema";
import {
  capturedBatch,
  chequePaidBatch,
  REASON,
  refundRow,
} from "@/server/modules/payments/refunds/testing";
import {
  confirmReviewedReceipt,
  offlinePaymentOf,
  openOrder,
  reviewCasesOf,
  schoolWithStudents,
  signInStaff,
  uploadProof,
} from "@/server/modules/payments/testing";
import { emit } from "@/server/outbox/emit";
import { createHarness, type Harness } from "@/test/harness";

async function ledgerRows(h: Harness) {
  return {
    postings: await h.db
      .select()
      .from(ledgerPosting)
      .orderBy(ledgerPosting.seq),
    lines: await h.db
      .select({
        postingId: ledgerLine.postingId,
        code: ledgerAccount.code,
        debit: ledgerLine.debitMinor,
        credit: ledgerLine.creditMinor,
        currency: ledgerLine.currency,
      })
      .from(ledgerLine)
      .innerJoin(ledgerAccount, eq(ledgerLine.accountId, ledgerAccount.id))
      .orderBy(ledgerLine.postingId, ledgerLine.lineNo),
    audits: await h.db
      .select()
      .from(auditLog)
      .where(like(auditLog.action, "ledger.%"))
      .orderBy(auditLog.id),
  };
}

describe("automatic capture postings", () => {
  it.each(["backfill", "outbox"] as const)(
    "books only the retained capture in a legacy review batch through the %s",
    async (delivery) => {
      const h = await createHarness();
      const paid = await capturedBatch(h, { students: 1 });
      const capturedAt = h.clock.now();
      h.clock.advance({ minutes: 1 });
      const second = h.gateway.capture(paid.orderId);
      expect(
        await h.as(h.visitor()).receiveGatewayWebhook(
          h.gateway.webhook({
            type: "payment.captured",
            orderId: paid.orderId,
          })
        )
      ).toEqual({ ok: true, outcome: "needs_review" });
      expect(await reviewCasesOf(h, paid.batchId)).toEqual([
        expect.objectContaining({
          batchStatusBefore: "captured",
          gatewayPaymentId: second.paymentId,
          resolvedAt: null,
        }),
      ]);
      // Before #80a, opening this case changed the batch's status but kept
      // the original receipt and its capture time.
      await h.db
        .update(paymentBatch)
        .set({ status: "needs_review" })
        .where(eq(paymentBatch.id, paid.batchId));
      expect(await ledgerRows(h)).toEqual({
        postings: [],
        lines: [],
        audits: [],
      });

      const system = h.as({ kind: "system", process: "cli" });
      if (delivery === "backfill") {
        expect(await system.backfillLedgerFromPayments()).toEqual({
          capturesPosted: 1,
          donationsPosted: 0,
          foreignPosted: 0,
          refundsPosted: 0,
        });
      } else {
        await h.drain();
      }
      const posted = await ledgerRows(h);
      expect(posted.postings).toEqual([
        expect.objectContaining({
          sourceType: "payment_capture",
          sourceId: paid.paymentId,
          occurredAt: capturedAt,
        }),
      ]);
      const postingId = posted.postings[0]!.id;
      expect(posted.lines).toEqual([
        {
          postingId,
          code: "1100",
          debit: 50_000n,
          credit: 0n,
          currency: "INR",
        },
        {
          postingId,
          code: "4100",
          debit: 0n,
          credit: 50_000n,
          currency: "INR",
        },
      ]);
      expect(posted.audits).toMatchObject([
        { action: "ledger.posting_created", entityId: postingId },
      ]);

      expect(await system.backfillLedgerFromPayments()).toEqual({
        capturesPosted: 0,
        donationsPosted: 0,
        foreignPosted: 0,
        refundsPosted: 0,
      });
      await h.drain();
      expect(await ledgerRows(h)).toEqual(posted);
    }
  );

  it.each(["outbox", "backfill"] as const)(
    "books the accepted receipt amount for a short payment through the %s",
    async (delivery) => {
      const h = await createHarness();
      const { batchId, orderId } = await openOrder(
        await schoolWithStudents(h, { students: 2 })
      );
      const { paymentId } = h.gateway.capture(orderId, {
        amount: { amountMinor: 99_900n, currency: "INR" },
      });
      expect(
        await h
          .as(h.visitor())
          .receiveGatewayWebhook(
            h.gateway.webhook({ type: "payment.captured", orderId })
          )
      ).toEqual({ ok: true, outcome: "needs_review" });
      const [opened] = await reviewCasesOf(h, batchId);
      expect(opened).toMatchObject({
        reason: "amount_mismatch",
        gatewayPaymentId: paymentId,
      });
      const { actor } = await signInStaff(h);
      expect(
        await h.as(actor).resolvePaymentReviewCase({
          caseId: opened!.id,
          outcome: "confirm",
          reason: "Accept the short payment after reviewing the receipt",
        })
      ).toEqual({ ok: true, batchStatus: "captured" });

      if (delivery === "backfill") {
        expect(
          await h
            .as({ kind: "system", process: "cli" })
            .backfillLedgerFromPayments()
        ).toEqual({
          capturesPosted: 1,
          donationsPosted: 0,
          foreignPosted: 0,
          refundsPosted: 0,
        });
      } else {
        await h.drain();
      }
      const posted = await ledgerRows(h);
      expect(posted.postings).toEqual([
        expect.objectContaining({
          sourceType: "payment_capture",
          sourceId: paymentId,
        }),
      ]);
      expect(posted.lines).toMatchObject([
        { code: "1100", debit: 99_900n, credit: 0n, currency: "INR" },
        { code: "4100", debit: 0n, credit: 99_900n, currency: "INR" },
      ]);
      expect(posted.audits).toMatchObject([
        { action: "ledger.posting_created", after: { totalMinor: "99900" } },
      ]);
      await h.drain();
      expect(await ledgerRows(h)).toEqual(posted);
    }
  );

  it("refuses to book an accepted review receipt in another currency", async () => {
    const h = await createHarness();
    const { batchId, orderId } = await openOrder(
      await schoolWithStudents(h, { students: 1 })
    );
    h.gateway.capture(orderId, {
      amount: { amountMinor: 50_000n, currency: "USD" },
    });
    expect(
      await h
        .as(h.visitor())
        .receiveGatewayWebhook(
          h.gateway.webhook({ type: "payment.captured", orderId })
        )
    ).toEqual({ ok: true, outcome: "needs_review" });
    const [opened] = await reviewCasesOf(h, batchId);
    const { actor } = await signInStaff(h);
    expect(
      await confirmReviewedReceipt(
        h,
        h.as(actor),
        opened!,
        "Accept the payment after reviewing the receipt"
      )
    ).toEqual({ ok: true, batchStatus: "captured" });

    await expect(
      h
        .as({ kind: "system", process: "worker" })
        .postPaymentCapture({ batchId })
    ).rejects.toThrow("Ledger capture requires INR");
    expect(await ledgerRows(h)).toEqual({
      postings: [],
      lines: [],
      audits: [],
    });
  });

  it("posts a gateway capture once, in balanced INR paise, even if the event is emitted again", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 2 });
    expect((await ledgerRows(h)).postings).toEqual([]);

    await h.drain();
    const before = await ledgerRows(h);
    expect(
      h.email.sent.filter(({ subject }) =>
        subject.startsWith("Payment received")
      )
    ).toHaveLength(1);
    expect(before.postings).toEqual([
      expect.objectContaining({
        sourceType: "payment_capture",
        sourceId: paid.paymentId,
        competitionId: paid.school.competition.id,
        occurredAt: h.clock.now(),
        createdByUserId: null,
        description: messages.adminLedger.postingDescriptions.payment_capture,
      }),
    ]);
    expect(
      before.lines.map(({ code, debit, credit, currency }) => ({
        code,
        debit,
        credit,
        currency,
      }))
    ).toEqual([
      { code: "1100", debit: 100_000n, credit: 0n, currency: "INR" },
      { code: "4100", debit: 0n, credit: 100_000n, currency: "INR" },
    ]);
    expect(
      await h.db.execute(sql`
      SELECT sum(debit_minor)::text AS debit, sum(credit_minor)::text AS credit FROM ledger_line
    `)
    ).toMatchObject({ rows: [{ debit: "100000", credit: "100000" }] });
    expect(before.audits).toEqual([
      expect.objectContaining({
        action: "ledger.posting_created",
        entityId: before.postings[0]!.id,
        actorKind: "system",
        before: null,
        after: expect.objectContaining({ totalMinor: "100000", lineCount: 2 }),
      }),
    ]);

    await emit(h.db, h.clock, {
      type: "payment.batch_captured",
      aggregate: { type: "payment_batch", id: paid.batchId },
      payload: { batchId: paid.batchId, payerUserId: null },
    });
    await h.drain();
    expect(await ledgerRows(h)).toEqual(before);
  });

  it.each([
    { method: "bank_transfer", reference: "UTRABC123456", code: "1000" },
    { method: "cheque", reference: "004512", code: "1000" },
    { method: "cash", reference: "FOA/2027/0012", code: "1010" },
  ] as const)(
    "posts an offline $method using its own id and receipt date",
    async ({ method, reference, code }) => {
      const h = await createHarness();
      const school = await schoolWithStudents(h, { students: 1 });
      const { batchId } = await openOrder(school);
      const { actor } = await signInStaff(h);
      const proofFileId = await uploadProof(h, actor, batchId, "clean");
      expect(
        await h.as(actor).recordOfflinePayment({
          batchId,
          method,
          reference,
          amount: "500",
          receivedOn: "2027-01-14",
          proofFileId,
        })
      ).toMatchObject({ ok: true });

      await h.drain();
      const rows = await ledgerRows(h);
      expect(rows.postings).toEqual([
        expect.objectContaining({
          sourceType: "offline_payment",
          sourceId: (await offlinePaymentOf(h, batchId))!.id,
          occurredAt: new Date("2027-01-13T18:30:00Z"),
          description: messages.adminLedger.postingDescriptions.offline_payment,
        }),
      ]);
      expect(
        rows.lines.map((line) => [line.code, line.debit, line.credit])
      ).toEqual([
        [code, 50_000n, 0n],
        ["4100", 0n, 50_000n],
      ]);
    }
  );

  it("allows only the system to run the capture use case", async () => {
    const h = await createHarness();
    const { batchId } = await capturedBatch(h, { students: 1 });
    const finance = await signInStaff(h);
    await expect(
      h.as(finance.actor).postPaymentCapture({ batchId })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await ledgerRows(h)).postings).toEqual([]);
    expect(
      await h
        .as({ kind: "system", process: "worker" })
        .postPaymentCapture({ batchId })
    ).toMatchObject({ outcome: "posted" });
  });
});

async function approveRefund(
  h: Harness,
  batchId: string,
  registrationIds?: string[]
) {
  const staff = await signInStaff(h, "staff_admin");
  const request = await h.as(staff.actor).requestRefund({
    batchId,
    reason: REASON,
    ...(registrationIds ? { registrationIds } : {}),
  });
  if (!request.ok) throw new Error(request.error);
  const finance = await signInStaff(h);
  expect(
    await h.as(finance.actor).approveRefund({ refundId: request.refundId })
  ).toMatchObject({ ok: true });
  return { refundId: request.refundId, finance };
}

describe("automatic refund postings", () => {
  it("mirrors only the refunded amount, leaves the capture intact and ignores a re-emitted event", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);
    await h.drain();
    const capture = await ledgerRows(h);

    const { refundId, finance } = await approveRefund(h, paid.batchId, [
      paid.registrationIds[0]!,
    ]);
    await expect(
      h.as(finance.actor).postRefund({ refundId })
    ).rejects.toMatchObject({ code: "forbidden" });
    h.gateway.answerNextRefund("pending");
    await h.drain();
    expect(await ledgerRows(h)).toEqual(capture);

    const gatewayRefund = h.gateway.refunds[0]!;
    h.gateway.settleRefund(gatewayRefund.id, "processed");
    const signal = h.gateway.webhook({
      type: "refund.processed",
      orderId: paid.orderId,
      refund: { refundId: gatewayRefund.id, paymentId: paid.paymentId },
    });
    expect(await h.as(h.visitor()).receiveGatewayWebhook(signal)).toMatchObject(
      { ok: true, outcome: "refund_updated" }
    );
    await h.drain();
    const settled = await ledgerRows(h);
    const original = capture.postings[0]!;
    const reversal = settled.postings[1]!;
    expect(settled.postings).toEqual([
      original,
      expect.objectContaining({
        sourceType: "refund",
        sourceId: refundId,
        reversalOfPostingId: original.id,
        description: messages.adminLedger.postingDescriptions.refund,
      }),
    ]);
    expect(
      settled.lines.filter((line) => line.postingId === original.id)
    ).toEqual(capture.lines);
    expect(
      settled.lines.filter((line) => line.postingId === reversal.id)
    ).toEqual([
      {
        postingId: reversal.id,
        code: "4100",
        debit: 50_000n,
        credit: 0n,
        currency: "INR",
      },
      {
        postingId: reversal.id,
        code: "1100",
        debit: 0n,
        credit: 50_000n,
        currency: "INR",
      },
    ]);
    expect(settled.audits.map((row) => row.action)).toEqual([
      "ledger.posting_created",
      "ledger.posting_created",
    ]);

    await emit(h.db, h.clock, {
      type: "refund.processed",
      aggregate: { type: "refund", id: refundId },
      payload: { refundId, payerUserId: null },
    });
    await h.drain();
    expect(await ledgerRows(h)).toEqual(settled);
  });

  it("posts the original capture when its outbox delivery is still pending", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 1 });
    const { refundId } = await approveRefund(h, paid.batchId);
    await h.db
      .update(outbox)
      .set({ availableAt: new Date(h.clock.now().getTime() + 60_000) })
      .where(
        and(
          eq(outbox.aggregateId, paid.batchId),
          eq(outbox.handler, "ledger.post_capture")
        )
      );

    await h.drain();
    const posted = await ledgerRows(h);
    const [capture, reversal] = posted.postings;
    expect(capture).toMatchObject({
      sourceType: "payment_capture",
      sourceId: paid.paymentId,
    });
    expect(reversal).toMatchObject({
      sourceType: "refund",
      sourceId: refundId,
      reversalOfPostingId: capture!.id,
    });
    h.clock.advance({ minutes: 1 });
    await h.drain();
    expect(await ledgerRows(h)).toEqual(posted);
  });

  it("credits cash when finance refunds a cheque payment in cash", async () => {
    const h = await createHarness();
    const paid = await chequePaidBatch(h, { students: 1 });
    const { refundId, finance } = await approveRefund(h, paid.batchId);
    expect(
      await h.as(finance.actor).recordManualRefund({
        refundId,
        method: "cash",
        reference: "FOA/2027/0032",
      })
    ).toMatchObject({ ok: true });
    await h.drain();
    const posted = await ledgerRows(h);
    const [capture, reversal] = posted.postings;
    expect(reversal).toMatchObject({
      reversalOfPostingId: capture!.id,
      sourceId: refundId,
    });
    expect(
      posted.lines
        .filter((line) => line.postingId === reversal!.id)
        .map((line) => [line.code, line.debit, line.credit])
    ).toEqual([
      ["4100", 50_000n, 0n],
      ["1010", 0n, 50_000n],
    ]);
  });

  it("keeps the booked registration fees when Payments refunds a second payment held in review", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 1 });
    await h.drain();
    const original = await ledgerRows(h);
    const second = h.gateway.capture(paid.orderId);
    await h.as(h.visitor()).receiveGatewayWebhook(
      h.gateway.webhook({
        type: "payment.captured",
        orderId: paid.orderId,
      })
    );
    const [opened] = await reviewCasesOf(h, paid.batchId);
    const staff = await signInStaff(h, "staff_admin");
    expect(
      await h.as(staff.actor).resolvePaymentReviewCase({
        caseId: opened!.id,
        outcome: "refund",
        reason: "Refund the duplicate payment",
      })
    ).toMatchObject({ ok: true });
    await h.drain();
    const [duplicate] = await h.db
      .select({ id: refund.id })
      .from(refund)
      .where(eq(refund.reviewCaseId, opened!.id));
    expect(await refundRow(h, duplicate!.id)).toMatchObject({
      status: "refunded",
      kind: "duplicate",
      gatewayPaymentId: second.paymentId,
    });
    expect(await ledgerRows(h)).toEqual(original);
  });
});
