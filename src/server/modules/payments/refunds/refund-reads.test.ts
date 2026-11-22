import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";

import { signInStaff } from "../testing";
import {
  capturedBatch,
  FEE_PAISE,
  REASON,
  signInManager,
  type CapturedBatch,
} from "./testing";

// #80 slice 5 (reads): the finance queue, one refund's page and the
// request page's batch. Students appear by registration number, never by
// name.

async function ask(
  h: Harness,
  paid: CapturedBatch,
  registrationIds?: string[]
) {
  const staff = await signInStaff(h, "staff_admin");
  const result = await h.as(staff.actor).requestRefund({
    batchId: paid.batchId,
    reason: REASON,
    ...(registrationIds ? { registrationIds } : {}),
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return { refundId: result.refundId, staff };
}

describe("listRefunds", () => {
  it("lists refunds waiting for finance newest first, then those in progress and done", async () => {
    const h = await createHarness();
    const older = await capturedBatch(h, {
      students: 2,
      name: "Banyan School",
    });
    const first = await ask(h, older);
    h.clock.advance({ minutes: 2 });
    const newer = await capturedBatch(h, { students: 3, code: "KITE27" });
    const second = await ask(h, newer, [newer.registrationIds[0]!]);
    const finance = await signInStaff(h, "finance");

    expect(await h.as(finance.actor).listRefunds({ state: "waiting" })).toEqual(
      {
        ok: true,
        refunds: [
          expect.objectContaining({
            id: second.refundId,
            kind: "discretionary",
            status: "requested",
            amountMinor: FEE_PAISE,
            students: 1,
            competitionName: "Competition KITE27",
            payer: { kind: "institution", name: "Test School" },
          }),
          expect.objectContaining({
            id: first.refundId,
            amountMinor: FEE_PAISE * 2n,
            students: 2,
            payer: { kind: "institution", name: "Banyan School" },
          }),
        ],
      }
    );

    await h.as(finance.actor).approveRefund({ refundId: first.refundId });
    expect(
      await h.as(finance.actor).listRefunds({ state: "in_progress" })
    ).toMatchObject({ ok: true, refunds: [{ id: first.refundId }] });
    await h.drain();
    expect(
      await h.as(finance.actor).listRefunds({ state: "done" })
    ).toMatchObject({
      ok: true,
      refunds: [{ id: first.refundId, status: "refunded" }],
    });
  });

  it("lets finance, staff admins and global managers list, and refuses a member and a manager of one competition", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);
    for (const actor of [
      (await signInStaff(h, "finance")).actor,
      (await signInStaff(h, "staff_admin")).actor,
      (await signInManager(h, "global")).actor,
    ]) {
      expect(await h.as(actor).listRefunds({ state: "waiting" })).toMatchObject(
        { ok: true }
      );
    }
    for (const actor of [
      await h.signIn(await h.seed.member()),
      (await signInManager(h, paid.school)).actor,
    ]) {
      await expect(
        h.as(actor).listRefunds({ state: "waiting" })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});

describe("getRefund", () => {
  it("shows the refund, its students by number, and what the viewer may do", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 2 });
    const { refundId, staff } = await ask(h, paid);
    const finance = await signInStaff(h, "finance");

    const seen = await h.as(finance.actor).getRefund({ refundId });

    expect(seen).toMatchObject({
      ok: true,
      refund: {
        id: refundId,
        batchId: paid.batchId,
        status: "requested",
        reason: REASON,
        amountMinor: FEE_PAISE * 2n,
        batchAmountMinor: FEE_PAISE * 2n,
        gatewayPaymentId: paid.paymentId,
        students: 2,
        viewer: { mayDecide: true, isRequester: false },
      },
    });
    if (!seen.ok) return;
    expect(seen.refund.items).toEqual(
      [...paid.registrationIds].sort().map((registrationId) => ({
        registrationId,
        registrationNumber: expect.stringMatching(/^PAWS27-R-/),
        status: "confirmed",
        amountMinor: FEE_PAISE,
        released: false,
      }))
    );
    expect(await h.as(staff.actor).getRefund({ refundId })).toMatchObject({
      ok: true,
      refund: { viewer: { mayDecide: false, isRequester: true } },
    });
  });

  it("lets a manager of that competition read it, and refuses a member", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);
    const { refundId } = await ask(h, paid);

    expect(
      await h.as((await signInManager(h, paid.school)).actor).getRefund({
        refundId,
      })
    ).toMatchObject({ ok: true });
    await expect(
      h.as(await h.signIn(await h.seed.member())).getRefund({ refundId })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("getRefundableBatch", () => {
  it("shows the request page each student's standing with refunds, and the batch's refunds", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 3 });
    const ids = [...paid.registrationIds].sort();
    const { refundId } = await ask(h, paid, [ids[0]!]);
    const manager = await signInManager(h, paid.school);

    const result = await h
      .as(manager.actor)
      .getRefundableBatch({ batchId: paid.batchId });

    expect(result).toMatchObject({
      ok: true,
      batch: {
        id: paid.batchId,
        status: "captured",
        captureMethod: "gateway",
        amountMinor: FEE_PAISE * 3n,
        competitionName: "Paws on the Pavement",
        refunds: [{ id: refundId, status: "requested" }],
      },
    });
    if (!result.ok) return;
    expect(
      result.batch.items.map((item) => [item.registrationId, item.refund])
    ).toEqual([
      [ids[0], "live"],
      [ids[1], "none"],
      [ids[2], "none"],
    ]);
  });

  it("refuses the school's coordinator and finance, who don't ask for refunds", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);

    for (const actor of [
      paid.school.coordinator.actor,
      (await signInStaff(h, "finance")).actor,
    ]) {
      await expect(
        h.as(actor).getRefundableBatch({ batchId: paid.batchId })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});
