import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  paymentBatch,
  paymentBatchItem,
  refund,
  refundItem,
} from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { createHarness } from "@/test/harness";

import {
  batchRow,
  openOrder,
  schoolWithStudents,
  signInStaff,
} from "../testing";
import {
  capturedBatch,
  chequePaidBatch,
  FEE_PAISE,
  REASON,
  refundAudit,
  refundItemsOf,
  refundRow,
  signInManager,
} from "./testing";

// #80 slice 1: a competition manager or staff admin asks for a refund of a
// captured batch, whole or for some of its students. Nothing is sent: the
// refund waits for finance.

describe("requestRefund", () => {
  it("asks for the whole batch: every student, the batch's amount, waiting for finance", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 3 });
    const manager = await signInManager(h, paid.school);

    const result = await h
      .as(manager.actor)
      .requestRefund({ batchId: paid.batchId, reason: `  ${REASON}  ` });

    expect(result).toEqual({
      ok: true,
      refundId: expect.any(String),
      amountMinor: FEE_PAISE * 3n,
      registrationIds: [...paid.registrationIds].sort(),
    });
    if (!result.ok) return;
    expect(await refundRow(h, result.refundId)).toMatchObject({
      batchId: paid.batchId,
      kind: "discretionary",
      status: "requested",
      method: "gateway",
      gatewayPaymentId: paid.paymentId,
      amountMinor: FEE_PAISE * 3n,
      currency: "INR",
      reason: REASON,
      requestedBy: manager.userId,
      requestedAt: h.clock.now(),
      decidedBy: null,
    });
    expect(
      (await refundItemsOf(h, result.refundId)).map((item) => ({
        registrationId: item.registrationId,
        amountMinor: item.amountMinor,
        releasedAt: item.releasedAt,
      }))
    ).toEqual(
      [...paid.registrationIds].sort().map((registrationId) => ({
        registrationId,
        amountMinor: FEE_PAISE,
        releasedAt: null,
      }))
    );
    const audit = await refundAudit(h);
    expect(audit).toMatchObject([
      {
        action: "refund.requested",
        actorUserId: manager.userId,
        actorRole: "competition_manager",
        entityType: "refund",
        entityId: result.refundId,
        before: null,
        after: {
          batchId: paid.batchId,
          kind: "discretionary",
          status: "requested",
          method: "gateway",
          amountMinor: String(FEE_PAISE * 3n),
          registrationIds: [...paid.registrationIds].sort(),
        },
      },
    ]);
    expect(JSON.stringify(audit[0]?.after)).not.toContain("Student");
    expect(h.gateway.refunds).toHaveLength(0);
  });

  it("asks for some students only: the amount is theirs", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 5 });
    const staff = await signInStaff(h, "staff_admin");
    const [first, , third] = paid.registrationIds;

    const result = await h.as(staff.actor).requestRefund({
      batchId: paid.batchId,
      registrationIds: [third!, first!],
      reason: REASON,
    });

    expect(result).toMatchObject({
      ok: true,
      amountMinor: FEE_PAISE * 2n,
      registrationIds: [third, first],
    });
  });

  it("asks a batch paid by cheque to be paid back by hand", async () => {
    const h = await createHarness();
    const paid = await chequePaidBatch(h);
    const staff = await signInStaff(h, "staff_admin");

    const result = await h
      .as(staff.actor)
      .requestRefund({ batchId: paid.batchId, reason: REASON });

    expect(result).toMatchObject({ ok: true, amountMinor: FEE_PAISE * 2n });
    if (!result.ok) return;
    expect(await refundRow(h, result.refundId)).toMatchObject({
      method: "manual",
      gatewayPaymentId: null,
    });
  });

  it("refuses students already in a live refund, of another batch, twice over, or none", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 3 });
    const other = await capturedBatch(h, { students: 1, code: "KITE27" });
    const staff = await signInStaff(h, "staff_admin");
    const [first, second] = paid.registrationIds;
    const ask = (registrationIds: string[]) =>
      h.as(staff.actor).requestRefund({
        batchId: paid.batchId,
        registrationIds,
        reason: REASON,
      });
    await ask([first!]);

    expect(await ask([second!, first!])).toEqual({
      ok: false,
      error: "item_in_live_refund",
      registrationId: first,
    });
    expect(await ask([other.registrationIds[0]!])).toEqual({
      ok: false,
      error: "unknown_item",
      registrationId: other.registrationIds[0],
    });
    expect(await ask([second!, second!])).toEqual({
      ok: false,
      error: "duplicate_item",
      registrationId: second,
    });
    expect(await ask([])).toEqual({ ok: false, error: "empty" });
  });

  it("refuses a whole-batch request once every student is in a refund", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 1 });
    const staff = await signInStaff(h, "staff_admin");
    const ask = () =>
      h
        .as(staff.actor)
        .requestRefund({ batchId: paid.batchId, reason: REASON });
    await ask();

    expect(await ask()).toEqual({ ok: false, error: "nothing_to_refund" });
  });

  it("refuses a batch that isn't paid, and one that doesn't exist", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId } = await openOrder(school);
    const staff = await signInStaff(h, "staff_admin");

    expect(
      await h.as(staff.actor).requestRefund({ batchId, reason: REASON })
    ).toEqual({ ok: false, error: "batch_not_captured" });
    expect(
      await h
        .as(staff.actor)
        .requestRefund({ batchId: uuidv7(h.clock.now()), reason: REASON })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("needs a reason of 1 to 500 characters", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);
    const staff = await signInStaff(h, "staff_admin");
    const ask = (reason: string) =>
      h.as(staff.actor).requestRefund({ batchId: paid.batchId, reason });

    expect(await ask("   ")).toEqual({ ok: false, error: "reason_required" });
    expect(await ask("x".repeat(501))).toEqual({
      ok: false,
      error: "reason_too_long",
    });
    expect(await ask("हु".repeat(500))).toMatchObject({ ok: true });
  });

  it("can't skip approval: a kind or status in the input is refused, and no use case starts a system refund", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);
    const staff = await signInStaff(h, "staff_admin");
    const finance = await signInStaff(h, "finance");

    for (const extra of [{ kind: "duplicate" }, { status: "approved" }]) {
      expect(
        await h.as(staff.actor).requestRefund({
          batchId: paid.batchId,
          reason: REASON,
          ...extra,
        } as never)
      ).toMatchObject({ ok: false, error: "invalid_input" });
    }
    expect(await h.db.select().from(refund)).toEqual([]);
    expect("startSystemRefund" in h.as(finance.actor)).toBe(false);
    expect("syncRefund" in h.as(finance.actor)).toBe(false);
  });

  it("lets only one live refund hold a student, even written directly", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 1 });
    const staff = await signInStaff(h, "staff_admin");
    const asked = await h
      .as(staff.actor)
      .requestRefund({ batchId: paid.batchId, reason: REASON });
    if (!asked.ok) throw new Error("not asked");
    const second = await h.db
      .insert(refund)
      .values({
        id: uuidv7(h.clock.now()),
        batchId: paid.batchId,
        gatewayPaymentId: paid.paymentId,
        kind: "discretionary",
        status: "requested",
        method: "gateway",
        amountMinor: FEE_PAISE,
        reason: REASON,
        requestedAt: h.clock.now(),
        updatedAt: h.clock.now(),
      })
      .returning({ id: refund.id });

    await expect(
      h.db.insert(refundItem).values({
        refundId: second[0]!.id,
        batchId: paid.batchId,
        registrationId: paid.registrationIds[0]!,
        amountMinor: FEE_PAISE,
      })
    ).rejects.toThrow();
  });

  it("names the student another refund took between the plan and the write, for a whole batch too", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 2 });
    const [first, taken] = [...paid.registrationIds].sort();
    // A live refund of another batch holds `taken`: the plan, which reads
    // this batch's refunds, can't see it, as it couldn't see a refund
    // written by another connection after it read.
    const batch = await batchRow(h, paid.batchId);
    const now = h.clock.now();
    const otherBatchId = uuidv7(now);
    await h.db.insert(paymentBatch).values({
      ...batch,
      id: otherBatchId,
      status: "cancelled",
      gatewayOrderId: null,
      gatewayPaymentId: null,
      captureMethod: null,
      capturedAt: null,
    });
    await h.db.insert(paymentBatchItem).values({
      batchId: otherBatchId,
      registrationId: taken!,
      amountMinor: FEE_PAISE,
      releasedAt: now,
    });
    const [other] = await h.db
      .insert(refund)
      .values({
        id: uuidv7(now),
        batchId: otherBatchId,
        kind: "discretionary",
        status: "approved",
        method: "manual",
        amountMinor: FEE_PAISE,
        reason: REASON,
        requestedAt: now,
        updatedAt: now,
      })
      .returning({ id: refund.id });
    await h.db.insert(refundItem).values({
      refundId: other!.id,
      batchId: otherBatchId,
      registrationId: taken!,
      amountMinor: FEE_PAISE,
    });
    const staff = await signInStaff(h, "staff_admin");

    expect(
      await h
        .as(staff.actor)
        .requestRefund({ batchId: paid.batchId, reason: REASON })
    ).toEqual({
      ok: false,
      error: "item_in_live_refund",
      registrationId: taken,
    });
    expect(
      await h.as(staff.actor).requestRefund({
        batchId: paid.batchId,
        registrationIds: [first!, taken!],
        reason: REASON,
      })
    ).toEqual({
      ok: false,
      error: "item_in_live_refund",
      registrationId: taken,
    });
    expect(
      await h.db.select().from(refund).where(eq(refund.batchId, paid.batchId))
    ).toEqual([]);

    const partial = await h.as(staff.actor).requestRefund({
      batchId: paid.batchId,
      registrationIds: [first!],
      reason: REASON,
    });
    if (!partial.ok) throw new Error("not asked");
    const before = await h.db
      .select()
      .from(refund)
      .where(eq(refund.batchId, paid.batchId));
    expect(
      await h
        .as(staff.actor)
        .requestRefund({ batchId: paid.batchId, reason: REASON })
    ).toEqual({
      ok: false,
      error: "item_in_live_refund",
      registrationId: taken,
    });
    expect(
      await h.db.select().from(refund).where(eq(refund.batchId, paid.batchId))
    ).toEqual(before);
  });

  describe("who may ask", () => {
    it("lets that competition's manager, a global manager and a staff admin ask", async () => {
      const h = await createHarness();
      const paid = await capturedBatch(h, { students: 3 });
      const askers = [
        await signInManager(h, paid.school),
        await signInManager(h, "global"),
        await signInStaff(h, "staff_admin"),
      ];

      for (const [index, asker] of askers.entries()) {
        expect(
          await h.as(asker.actor).requestRefund({
            batchId: paid.batchId,
            registrationIds: [paid.registrationIds[index]!],
            reason: REASON,
          })
        ).toMatchObject({ ok: true });
      }
    });

    it("refuses the school's coordinator, a member, finance and another competition's manager", async () => {
      const h = await createHarness();
      const paid = await capturedBatch(h);
      const elsewhere = await schoolWithStudents(h, {
        students: 1,
        code: "KITE27",
      });
      const member = await h.signIn(await h.seed.member());
      const refused = [
        paid.school.coordinator.actor,
        member,
        (await signInStaff(h, "finance")).actor,
        (await signInManager(h, elsewhere)).actor,
      ];

      for (const actor of refused) {
        await expect(
          h.as(actor).requestRefund({ batchId: paid.batchId, reason: REASON })
        ).rejects.toMatchObject({ code: "forbidden" });
      }
      expect(await h.db.select().from(refund)).toEqual([]);
    });
  });
});
