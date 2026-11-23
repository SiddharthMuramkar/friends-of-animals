import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  CHEQUE_SCAN,
  openOrder,
  schoolWithStudents,
  signInStaff,
  uploadProof,
  type PaymentsStaffRole,
  type School,
} from "./testing";

// #79: an offline payment's proof (a cheque image shows an account number
// and a signature) goes only to finance, staff admins and super admins,
// through a short-lived signed URL, and only once its scan passed, except
// to the person who uploaded it (#63's gate).

/** A batch paid by cheque, its proof uploaded by a finance user. */
async function paidByCheque(h: Harness, scan: "clean" | "scanning" = "clean") {
  const school = await schoolWithStudents(h, { students: 1 });
  const { batchId } = await openOrder(school);
  const uploader = await signInStaff(h, "finance");
  const proofFileId = await uploadProof(h, uploader.actor, batchId, scan);
  const recorded = await h.as(uploader.actor).recordOfflinePayment({
    batchId,
    method: "cheque",
    reference: "004512",
    amount: "500",
    receivedOn: "2027-01-15",
    proofFileId,
  });
  if (!recorded.ok) throw new Error(JSON.stringify(recorded));
  return { school, batchId, uploader, proofFileId };
}

describe("getOfflinePaymentProof", () => {
  it.each<PaymentsStaffRole>(["finance", "staff_admin", "super_admin"])(
    "gives a %s who didn't upload it a working link to a clean proof, and records the read",
    async (role) => {
      const h = await createHarness();
      const { batchId, proofFileId } = await paidByCheque(h);
      const reader = await signInStaff(h, role);

      const result = await h
        .as(reader.actor)
        .getOfflinePaymentProof({ batchId });

      expect(result).toEqual({
        ok: true,
        url: expect.any(String),
        expiresAt: new Date(h.clock.now().getTime() + 5 * 60 * 1000),
      });
      if (!result.ok) return;
      expect(await h.storage.get(result.url)).toMatchObject({
        ok: true,
        bytes: CHEQUE_SCAN,
      });
      expect(
        await h.db
          .select({
            actorUserId: auditLog.actorUserId,
            actorRole: auditLog.actorRole,
            entityId: auditLog.entityId,
          })
          .from(auditLog)
          .where(eq(auditLog.action, "payment.offline_proof_read"))
      ).toEqual([
        { actorUserId: reader.userId, actorRole: role, entityId: proofFileId },
      ]);
    }
  );

  it("holds a proof back from everyone but its uploader until the scan passes", async () => {
    const h = await createHarness();
    const { batchId, uploader } = await paidByCheque(h, "scanning");
    const colleague = await signInStaff(h, "finance");

    expect(
      await h.as(colleague.actor).getOfflinePaymentProof({ batchId })
    ).toEqual({ ok: false, error: "file_not_ready" });
    expect(
      await h.as(uploader.actor).getOfflinePaymentProof({ batchId })
    ).toMatchObject({ ok: true });
  });

  it("says when the batch wasn't paid offline", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const { batchId } = await openOrder(school);
    const finance = await signInStaff(h, "finance");

    expect(
      await h.as(finance.actor).getOfflinePaymentProof({ batchId })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it.each<[string, (h: Harness, school: School) => Promise<Actor>]>([
    [
      "the batch's own coordinator",
      async (_h, school) => school.coordinator.actor,
    ],
    [
      "a competition manager",
      async (h) => (await signInStaff(h, "competition_manager")).actor,
    ],
    ["a member", async (h) => (await signInStaff(h, null)).actor],
    ["a visitor", async (h) => h.visitor()],
  ])("refuses %s", async (_who, who) => {
    const h = await createHarness();
    const { school, batchId } = await paidByCheque(h);
    const actor = await who(h, school);

    await expect(
      h.as(actor).getOfflinePaymentProof({ batchId })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("getPaymentBatchForStaff", () => {
  it("shows an open batch that finance may record an offline payment for", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, {
      students: 2,
      name: "Banyan School",
    });
    const { batchId } = await openOrder(school);
    const finance = await signInStaff(h, "finance");

    expect(
      await h.as(finance.actor).getPaymentBatchForStaff({ batchId })
    ).toEqual({
      ok: true,
      batch: expect.objectContaining({
        id: batchId,
        status: "order_created",
        route: "institution",
        amountMinor: 100_000n,
        competitionName: "Paws on the Pavement",
        payer: { kind: "institution", name: "Banyan School" },
        reference: school.reference,
        captureMethod: null,
        canRecordOffline: true,
        students: [
          expect.objectContaining({ status: "enrolled", held: true }),
          expect.objectContaining({ status: "enrolled", held: true }),
        ],
        offlinePayment: null,
        reviewCases: [],
      }),
    });
  });

  it("shows the offline payment a batch was paid with, and who recorded it", async () => {
    const h = await createHarness();
    const { batchId, uploader } = await paidByCheque(h);
    const [recorder] = await h.db
      .select({ name: auditLog.actorUserId })
      .from(auditLog)
      .where(eq(auditLog.action, "payment.offline_recorded"));
    expect(recorder?.name).toBe(uploader.userId);
    const admin = await signInStaff(h, "staff_admin");

    const result = await h.as(admin.actor).getPaymentBatchForStaff({ batchId });

    expect(result).toMatchObject({
      ok: true,
      batch: {
        status: "captured",
        captureMethod: "offline",
        canRecordOffline: false,
        offlinePayment: {
          method: "cheque",
          reference: "004512",
          amountMinor: 50_000n,
          receivedOn: "2027-01-15",
          recordedAt: h.clock.now(),
          recordedByName: expect.any(String),
          proofStatus: "clean",
        },
      },
    });
  });

  it("says when there's no such batch", async () => {
    const h = await createHarness();
    const finance = await signInStaff(h, "finance");

    expect(
      await h.as(finance.actor).getPaymentBatchForStaff({
        batchId: "01938a00-0000-7000-8000-00000000dead",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it.each<[string, (h: Harness, school: School) => Promise<Actor>]>([
    [
      "the batch's own coordinator",
      async (_h, school) => school.coordinator.actor,
    ],
    ["a member", async (h) => (await signInStaff(h, null)).actor],
  ])("refuses %s", async (_who, who) => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const { batchId } = await openOrder(school);
    const actor = await who(h, school);

    await expect(
      h.as(actor).getPaymentBatchForStaff({ batchId })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
