import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import {
  auditLog,
  legalHold,
  paymentBatch,
  session,
  setting,
  verification,
} from "@/server/db/schema";
import {
  batchRow,
  offlinePaymentOf,
  openOrder,
  reviewCasesOf,
  schoolWithStudents,
  signInStaff,
  uploadProof,
} from "@/server/modules/payments/testing";
import {
  capturedBatch,
  refundRow,
} from "@/server/modules/payments/refunds/testing";
import { createHarness, type Harness } from "@/test/harness";

import { retentionRunAuditSchema } from "./domain/retention-plan";

const WORKER: Actor = { kind: "system", process: "worker" };

async function enforce(h: Harness) {
  await h.settings.set("retention.enforce", true);
}

async function sessionsOf(h: Harness, userId: string) {
  return h.db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId));
}

async function requestVerifications(h: Harness, phone: string) {
  const member = await h.seed.member({ phone });
  const signedIn = h.as(await h.signIn(member));
  const visitor = h.as(h.visitor());
  expect(await visitor.requestEmailCode({ email: member.email })).toEqual({
    ok: true,
  });
  expect(await visitor.requestPhoneCode({ phone })).toEqual({ ok: true });
  expect(
    await signedIn.registerAsGuardian({
      fullName: "Asha Rao",
      adultDeclared: true,
    })
  ).toEqual({ ok: true });
  expect(await signedIn.startGuardianVerification()).toMatchObject({
    ok: true,
  });
  return member.id;
}

async function holdAudit(h: Harness) {
  const rows = await h.db.select().from(auditLog);
  return rows.filter((row) => row.action.startsWith("privacy.hold_"));
}

/** The counts the latest retention run recorded for `policy`. */
async function lastCounts(h: Harness, policy: string) {
  const runs = await h.db
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(eq(auditLog.action, "privacy.retention_run"))
    .orderBy(auditLog.id);
  return retentionRunAuditSchema.parse(runs.at(-1)?.after).policies[policy];
}

/** A super admin signed in now, with a fresh second factor. */
async function superAdmin(h: Harness) {
  h.cookies.clear();
  return h.signIn(await h.seed.superAdmin());
}

async function staffAdmin(h: Harness) {
  const person = await h.seed.member();
  await h.seed.grant(person, {
    role: "staff_admin",
    scope: { type: "global" },
  });
  h.cookies.clear();
  return h.signIn(person);
}

const REASON = "Claim filed in the district consumer forum";

describe("placeLegalHold", () => {
  it("lets a super admin with a fresh second factor hold an account, audited by ids only", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const admin = await superAdmin(h);

    const result = await h.as(admin).placeLegalHold({
      subjectType: "user",
      subjectId: member.id,
      reason: `  ${REASON}  `,
    });

    expect(result).toEqual({ ok: true, holdId: expect.any(String) });
    const [hold] = await h.db.select().from(legalHold);
    expect(hold).toMatchObject({
      subjectType: "user",
      subjectId: member.id,
      reason: REASON,
      releasedAt: null,
    });
    const [audit] = await holdAudit(h);
    expect(audit).toMatchObject({
      action: "privacy.hold_placed",
      actorRole: "super_admin",
      entityType: "legal_hold",
      entityId: hold?.id,
      after: { subjectType: "user", subjectId: member.id },
    });
    expect(JSON.stringify(audit)).not.toContain("forum");
  });

  it("asks for a fresh second factor first, and writes nothing without one", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const admin = await superAdmin(h);
    h.clock.advance({ minutes: 11 });

    await expect(
      h.as(admin).placeLegalHold({
        subjectType: "user",
        subjectId: member.id,
        reason: REASON,
      })
    ).rejects.toMatchObject({ code: "step_up_required" });

    expect(await h.db.select().from(legalHold)).toEqual([]);
    expect(await holdAudit(h)).toEqual([]);
  });

  it("is for a super admin: a staff admin and a member are refused, and nothing is written", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const refused = [await staffAdmin(h)];
    h.cookies.clear();
    refused.push(await h.signIn(await h.seed.member()));

    for (const actor of refused) {
      await expect(
        h.as(actor).placeLegalHold({
          subjectType: "user",
          subjectId: member.id,
          reason: REASON,
        })
      ).rejects.toMatchObject({ code: "forbidden" });
    }

    expect(await h.db.select().from(legalHold)).toEqual([]);
    expect(await holdAudit(h)).toEqual([]);
  });

  it("refuses a second hold on the same subject, an unknown subject and a blank reason", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const admin = await superAdmin(h);
    const hold = { subjectType: "user", subjectId: member.id, reason: REASON };
    await h.as(admin).placeLegalHold(hold);

    expect(await h.as(admin).placeLegalHold(hold)).toEqual({
      ok: false,
      error: "already_held",
    });
    expect(
      await h.as(admin).placeLegalHold({
        ...hold,
        subjectType: "institution",
      })
    ).toEqual({ ok: false, error: "subject_not_found" });
    expect(
      await h.as(admin).placeLegalHold({ ...hold, reason: "   " })
    ).toEqual({ ok: false, error: "invalid_input", fields: ["reason"] });
    expect(
      await h.as(admin).placeLegalHold({ ...hold, subjectType: "donor" })
    ).toEqual({ ok: false, error: "invalid_input", fields: ["subjectType"] });
    expect(await h.db.select().from(legalHold)).toHaveLength(1);
  });
});

describe("a legal hold and the retention sweep", () => {
  it("keeps an expired released hold while a renewed hold covers the subject", async () => {
    const h = await createHarness();
    await enforce(h);
    const subject = await h.seed.member();
    const admin = await h.seed.superAdmin();
    const staff = h.as(await h.signIn(admin));
    const input = {
      subjectType: "user",
      subjectId: subject.id,
      reason: REASON,
    };
    const original = await staff.placeLegalHold(input);
    if (!original.ok) throw new Error(original.error);
    expect(await staff.releaseLegalHold({ holdId: original.holdId })).toEqual({
      ok: true,
    });

    h.clock.advance({ days: 364 });
    const renewed = await h.as(await h.signIn(admin)).placeLegalHold(input);
    if (!renewed.ok) throw new Error(renewed.error);
    h.clock.advance({ days: 1 });
    const worker = h.as(WORKER);
    const originalRow = () =>
      h.db.select().from(legalHold).where(eq(legalHold.id, original.holdId));
    expect(
      (await worker.runRetentionSweep()).policies.releasedLegalHolds
    ).toMatchObject({ deleted: 0, held: 1 });
    expect(await originalRow()).toMatchObject([{ reason: REASON }]);

    expect(
      await h
        .as(await h.signIn(admin))
        .releaseLegalHold({ holdId: renewed.holdId })
    ).toEqual({ ok: true });
    expect(
      (await worker.runRetentionSweep()).policies.releasedLegalHolds
    ).toMatchObject({ deleted: 1, held: 0 });
    expect(await originalRow()).toEqual([]);
    expect(await h.db.select({ id: legalHold.id }).from(legalHold)).toEqual([
      { id: renewed.holdId },
    ]);
  });

  it("keeps a held member's expired session, counted as held, until the hold is released", async () => {
    const h = await createHarness();
    await enforce(h);
    const member = await h.seed.member();
    await h.signIn(member);
    const admin = await superAdmin(h);
    const placed = await h.as(admin).placeLegalHold({
      subjectType: "user",
      subjectId: member.id,
      reason: REASON,
    });
    if (!placed.ok) throw new Error(placed.error);
    h.clock.advance({ days: 61 });

    await h.as(WORKER).runRetentionSweep();

    expect(await sessionsOf(h, member.id)).toHaveLength(1);
    expect(await lastCounts(h, "expiredSessions")).toMatchObject({ held: 1 });

    const again = await superAdmin(h);
    expect(
      await h.as(again).releaseLegalHold({ holdId: placed.holdId })
    ).toEqual({ ok: true });
    await h.as(WORKER).runRetentionSweep();

    expect(await sessionsOf(h, member.id)).toEqual([]);
    expect(await lastCounts(h, "expiredSessions")).toMatchObject({ held: 0 });
    const released = (await holdAudit(h)).find(
      (row) => row.action === "privacy.hold_released"
    );
    expect(released).toMatchObject({
      actorRole: "super_admin",
      entityId: placed.holdId,
      before: { subjectType: "user", subjectId: member.id },
    });
  });

  it("retains a held account's expired email, SMS and guardian verifications until release", async () => {
    const h = await createHarness();
    await enforce(h);
    await h.settings.set("sms.enabled", true);
    const admin = h.as(await superAdmin(h));
    const subjectId = await requestVerifications(h, "+919876543210");
    const rows = () =>
      h.db
        .select({ id: verification.id, expiresAt: verification.expiresAt })
        .from(verification)
        .orderBy(verification.id);
    const original = await rows();
    expect(original).toHaveLength(3);
    await requestVerifications(h, "+919876543211");
    expect(await rows()).toHaveLength(6);
    const hold = await admin.placeLegalHold({
      subjectType: "user",
      subjectId,
      reason: REASON,
    });
    if (!hold.ok) throw new Error(hold.error);
    h.clock.advance({ days: 1, minutes: 10 });

    const worker = h.as(WORKER);
    await worker.runRetentionSweep();
    expect(await lastCounts(h, "expiredVerifications")).toEqual({
      deleted: 3,
      anonymised: 0,
      held: 3,
      retainedByFloor: 0,
    });
    expect(await rows()).toEqual(original);

    const freshAdmin = h.as(await superAdmin(h));
    expect(await rows()).toEqual(original);
    expect(await freshAdmin.releaseLegalHold({ holdId: hold.holdId })).toEqual({
      ok: true,
    });
    await worker.runRetentionSweep();
    expect(await lastCounts(h, "expiredVerifications")).toMatchObject({
      deleted: 3,
      held: 0,
    });
    expect(await rows()).toEqual([]);
  });
});

describe("releaseLegalHold", () => {
  it("is for a super admin with a fresh second factor; a staff admin is refused", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const admin = await superAdmin(h);
    const placed = await h.as(admin).placeLegalHold({
      subjectType: "user",
      subjectId: member.id,
      reason: REASON,
    });
    if (!placed.ok) throw new Error(placed.error);
    const staff = await staffAdmin(h);

    await expect(
      h.as(staff).releaseLegalHold({ holdId: placed.holdId })
    ).rejects.toMatchObject({ code: "forbidden" });
    h.clock.advance({ minutes: 11 });
    await expect(
      h.as(admin).releaseLegalHold({ holdId: placed.holdId })
    ).rejects.toMatchObject({ code: "step_up_required" });

    const [hold] = await h.db.select().from(legalHold);
    expect(hold?.releasedAt).toBeNull();
  });

  it("says when the hold is already released, or doesn't exist", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const admin = await superAdmin(h);
    const placed = await h.as(admin).placeLegalHold({
      subjectType: "user",
      subjectId: member.id,
      reason: REASON,
    });
    if (!placed.ok) throw new Error(placed.error);
    await h.as(admin).releaseLegalHold({ holdId: placed.holdId });

    expect(
      await h.as(admin).releaseLegalHold({ holdId: placed.holdId })
    ).toEqual({ ok: false, error: "already_released" });
    expect(
      await h
        .as(admin)
        .releaseLegalHold({ holdId: "01938a00-0000-7000-8000-00000000dead" })
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("listLegalHolds", () => {
  it("returns two bounded pages in placement order, even if the cursor hold is released", async () => {
    const h = await createHarness();
    const admin = h.as(await superAdmin(h));
    const added = await h.db.execute<{ id: string }>(sql`
      INSERT INTO legal_hold (id, subject_type, subject_id, reason, placed_at)
      SELECT id, 'user', id, ${REASON}, ${h.clock.now().toISOString()}::timestamptz
      FROM (SELECT gen_random_uuid() AS id FROM generate_series(1, 51)) holds
      RETURNING id
    `);
    const ids = added.rows.map(({ id }) => id).sort();
    const first = await admin.listLegalHolds();
    expect(first).toMatchObject({
      holds: ids.slice(0, 50).map((id) => ({ id })),
      nextCursor: expect.any(String),
    });
    const boundary = ids[49]!;
    expect(await admin.releaseLegalHold({ holdId: boundary })).toEqual({
      ok: true,
    });
    const second = await admin.listLegalHolds(first.nextCursor ?? undefined);
    expect(second).toMatchObject({
      holds: [{ id: ids[50] }],
      nextCursor: null,
    });
  });

  it("shows staff admins and super admins the holds in force; a member is refused", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const admin = await superAdmin(h);
    await h.as(admin).placeLegalHold({
      subjectType: "user",
      subjectId: member.id,
      reason: REASON,
    });
    const staff = await staffAdmin(h);

    const page = await h.as(staff).listLegalHolds();
    expect(page.nextCursor).toBeNull();
    expect(page.holds).toEqual([
      {
        id: expect.any(String),
        subjectType: "user",
        subjectId: member.id,
        reason: REASON,
        placedAt: expect.any(Date),
        placedBy: { id: expect.any(String), name: expect.any(String) },
      },
    ]);
    h.cookies.clear();
    const someone = await h.signIn(await h.seed.member());
    await expect(h.as(someone).listLegalHolds()).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("the financial records floor", () => {
  it.each(["requested", "failed"] as const)(
    "preserves decision context for a %s refund until closure and expiry",
    async (status) => {
      const h = await createHarness();
      await enforce(h);
      const paid = await capturedBatch(h);
      const requester = await h.seed.member();
      for (const role of ["staff_admin", "finance"] as const) {
        await h.seed.grant(requester, { role, scope: { type: "global" } });
      }
      const asked = await h
        .as(await h.signIn(requester))
        .requestRefund({ batchId: paid.batchId, reason: REASON });
      if (!asked.ok) throw new Error(asked.error);
      const { refundId } = asked;
      const finance = await signInStaff(h);
      if (status === "failed") {
        expect(
          await h
            .as(finance.actor)
            .approveRefund({ refundId, note: "Approved for the school" })
        ).toEqual({ ok: true, status: "approved" });
        h.gateway.answerNextRefund("pending");
        await h.drain();
        const sent = h.gateway.refunds[0]!;
        h.gateway.settleRefund(sent.id, "failed");
        await h.as(h.visitor()).receiveGatewayWebhook(
          h.gateway.webhook({
            type: "refund.failed",
            orderId: paid.orderId,
            refund: { refundId: sent.id, paymentId: paid.paymentId },
          })
        );
      }
      const before = await refundRow(h, refundId);
      expect(before).toMatchObject({
        status,
        requestedBy: requester.id,
        reason: REASON,
      });
      h.clock.set("2036-04-02T00:00:00Z");
      const worker = h.as(WORKER);
      await worker.runRetentionSweep();
      expect(
        await h
          .as(await h.signIn(requester))
          .rejectRefund({ refundId, note: "Close the request" })
      ).toEqual({ ok: false, error: "same_person" });
      expect(await refundRow(h, refundId)).toEqual(before);

      const anotherDecider = await signInStaff(h);
      expect(
        await h
          .as(anotherDecider.actor)
          .rejectRefund({ refundId, note: "Close the request" })
      ).toEqual({ ok: true, status: "rejected" });
      await worker.runRetentionSweep();
      expect(await refundRow(h, refundId)).toMatchObject({
        requestedBy: requester.id,
        decidedBy: anotherDecider.userId,
        decisionNote: "Close the request",
      });
      h.clock.set("2045-03-31T18:30:00Z");
      expect(
        (await worker.runRetentionSweep()).policies.financialRecords
      ).toMatchObject({ anonymised: 1 });
      expect(await refundRow(h, refundId)).toMatchObject({
        status: "rejected",
        requestedBy: null,
        decidedBy: null,
        reason: "[removed]",
        decisionNote: null,
      });
    }
  );

  it("preserves a batch and its connected records while any financial actor is held", async () => {
    const h = await createHarness();
    await enforce(h);
    const { batchId, orderId } = await openOrder(await schoolWithStudents(h));
    const recorder = await signInStaff(h);
    const proofFileId = await uploadProof(h, recorder.actor, batchId, "clean");
    expect(
      await h.as(recorder.actor).recordOfflinePayment({
        batchId,
        method: "cheque",
        reference: "004512",
        amount: "1000",
        receivedOn: "2027-01-15",
        proofFileId,
      })
    ).toMatchObject({ ok: true });

    h.gateway.capture(orderId);
    expect(
      await h
        .as(h.visitor())
        .receiveGatewayWebhook(
          h.gateway.webhook({ type: "payment.captured", orderId })
        )
    ).toMatchObject({ ok: true });
    const [review] = await reviewCasesOf(h, batchId);
    if (!review) throw new Error("Missing payment review");
    const resolver = await signInStaff(h);
    expect(
      await h.as(resolver.actor).resolvePaymentReviewCase({
        caseId: review.id,
        outcome: "keep",
        reason: "FOA kept the duplicate payment.",
      })
    ).toMatchObject({ ok: true });

    const requester = await signInStaff(h, "staff_admin");
    const asked = await h.as(requester.actor).requestRefund({
      batchId,
      reason: "Return the school's fee.",
    });
    if (!asked.ok) throw new Error(asked.error);
    const decider = await signInStaff(h);
    expect(
      await h.as(decider.actor).approveRefund({ refundId: asked.refundId })
    ).toEqual({ ok: true, status: "approved" });
    const refundRecorder = await signInStaff(h);
    expect(
      await h.as(refundRecorder.actor).recordManualRefund({
        refundId: asked.refundId,
        method: "cheque",
        reference: "987654",
      })
    ).toEqual({ ok: true, status: "refunded" });

    const financialRows = async () => ({
      batch: await batchRow(h, batchId),
      offline: await offlinePaymentOf(h, batchId),
      reviews: await reviewCasesOf(h, batchId),
      refund: await refundRow(h, asked.refundId),
    });
    const before = await financialRows();
    const admin = await h.seed.superAdmin();
    h.clock.set("2036-04-01T00:00:00Z");
    const staff = h.as(await h.signIn(admin));
    const worker = h.as(WORKER);
    for (const { userId } of [
      recorder,
      resolver,
      requester,
      decider,
      refundRecorder,
    ]) {
      const hold = await staff.placeLegalHold({
        subjectType: "user",
        subjectId: userId,
        reason: REASON,
      });
      if (!hold.ok) throw new Error(hold.error);

      const sweep = await worker.runRetentionSweep();
      expect(sweep.policies.financialRecords).toMatchObject({
        held: 1,
        anonymised: 0,
      });
      expect(await financialRows()).toEqual(before);
      expect(await staff.releaseLegalHold({ holdId: hold.holdId })).toEqual({
        ok: true,
      });
    }

    const released = await worker.runRetentionSweep();
    expect(released.policies.financialRecords).toMatchObject({
      held: 0,
      anonymised: 1,
    });
    expect(await financialRows()).toMatchObject({
      batch: { payerUserId: null, status: "captured", amountMinor: 100_000n },
      offline: {
        recordedByUserId: null,
        reference: "[removed]",
        proofFileAssetId: proofFileId,
      },
      reviews: [{ resolvedByUserId: null, resolutionReason: "[removed]" }],
      refund: {
        status: "refunded",
        requestedBy: null,
        decidedBy: null,
        manualRecordedBy: null,
        manualReference: "[removed]",
      },
    });
  });

  it("keeps a payment's payer until 1 April, 8 years after its financial year ends, whatever the setting says", async () => {
    // 4 May 2026, 10:00 IST: financial year 2026-27, which ends on
    // 31 March 2027. The floor lapses at midnight IST on 1 April 2035.
    const h = await createHarness({ now: "2026-05-04T04:30:00Z" });
    await enforce(h);
    const school = await schoolWithStudents(h);
    const { batchId } = await openOrder(school);
    // Stored behind the settings screen's back: 30 days can't shorten it.
    await h.db.insert(setting).values({
      key: "retention.financialRecordsDays",
      value: 30,
      updatedAt: h.clock.now(),
    });
    const payer = async () => {
      const [row] = await h.db
        .select({ payer: paymentBatch.payerUserId })
        .from(paymentBatch)
        .where(eq(paymentBatch.id, batchId));
      return row?.payer;
    };

    h.clock.set(new Date("2026-06-04T04:30:00Z"));
    await h.as(WORKER).runRetentionSweep();
    expect(await payer()).toBe(school.coordinator.userId);

    h.clock.set(new Date("2035-03-31T18:29:59Z"));
    await h.as(WORKER).runRetentionSweep();
    expect(await payer()).toBe(school.coordinator.userId);
    expect(await lastCounts(h, "financialRecords")).toEqual({
      deleted: 0,
      anonymised: 0,
      held: 0,
      retainedByFloor: 1,
    });

    h.clock.set(new Date("2035-03-31T18:30:00Z"));
    await h.as(WORKER).runRetentionSweep();
    expect(await payer()).toBeNull();
    expect(await lastCounts(h, "financialRecords")).toMatchObject({
      anonymised: 1,
      retainedByFloor: 0,
    });

    await h.as(WORKER).runRetentionSweep();
    expect(await lastCounts(h, "financialRecords")).toMatchObject({
      anonymised: 0,
    });
  });

  it("refuses a period below the floor on the settings screen", async () => {
    const h = await createHarness();
    const admin = await superAdmin(h);

    expect(
      await h.as(admin).changeSetting({
        key: "retention.financialRecordsDays",
        value: 30,
      })
    ).toEqual({
      ok: false,
      error: "invalid_value",
      problem: { reason: "too_small", min: 2922 },
    });
  });
});
