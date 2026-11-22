import { describe, expect, it } from "vitest";

import { outbox, refund } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { signInStaff } from "../testing";
import {
  capturedBatch,
  FEE_PAISE,
  REASON,
  refundAudit,
  refundItemsOf,
  refundRow,
  refundRows,
  signInManager,
  statusesOf,
  type CapturedBatch,
} from "./testing";

// #80 slice 2: finance approves or rejects a requested refund behind a
// fresh second factor, never their own request. An approved refund goes
// to the gateway from the outbox (refunds.send): the drain sends it for
// the exact amount, keyed by the refund's id, and once the gateway has
// processed it the registrations it lists are refunded.

/** A staff admin's request for `registrationIds` (or the whole batch). */
async function requested(
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
  return { refundId: result.refundId, requester: staff };
}

describe("approveRefund", () => {
  it("needs a second factor from the last 10 minutes: one 10 min 1 s old is refused and changes nothing", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 2 });
    const { refundId } = await requested(h, paid);
    const finance = await signInStaff(h, "finance");
    const before = await refundRows(h);

    h.clock.advance({ minutes: 10, seconds: 1 });
    await expect(
      h.as(finance.actor).approveRefund({ refundId })
    ).rejects.toMatchObject({ code: "step_up_required" });

    expect(await refundRows(h)).toEqual(before);
    await h.drain();
    expect(h.gateway.refunds).toHaveLength(0);
  });

  it("approves with one 9 min 59 s old; the drain refunds the exact amount, keyed by the refund, and refunds the registrations", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 2 });
    const { refundId } = await requested(h, paid);
    const finance = await signInStaff(h, "finance");
    h.clock.advance({ minutes: 9, seconds: 59 });

    expect(
      await h
        .as(finance.actor)
        .approveRefund({ refundId, note: "Within policy." })
    ).toEqual({ ok: true, status: "approved" });
    expect(await refundRow(h, refundId)).toMatchObject({
      status: "approved",
      decidedBy: finance.userId,
      decidedAt: h.clock.now(),
      decisionNote: "Within policy.",
    });
    expect(h.gateway.refunds).toHaveLength(0);

    await h.drain();

    expect(h.gateway.refunds).toEqual([
      {
        id: expect.stringMatching(/^rfnd_fake_/),
        paymentId: paid.paymentId,
        amountMinor: FEE_PAISE * 2n,
        currency: "INR",
        status: "processed",
        notes: { refundId, attempt: "1" },
        idempotencyKey: `${refundId}-1`,
      },
    ]);
    expect(await refundRow(h, refundId)).toMatchObject({
      status: "refunded",
      gatewayRefundId: h.gateway.refunds[0]!.id,
      sentAt: h.clock.now(),
      refundedAt: h.clock.now(),
    });
    expect(await statusesOf(h, paid.registrationIds)).toEqual([
      "refunded",
      "refunded",
    ]);
    expect((await refundAudit(h)).map((entry) => entry.action)).toEqual([
      "refund.requested",
      "refund.approved",
      "refund.sent",
      "refund.refunded",
    ]);
    const [, approved, sent, done] = await refundAudit(h);
    expect(approved).toMatchObject({
      actorUserId: finance.userId,
      actorRole: "finance",
      before: { status: "requested" },
      after: { status: "approved", decidedBy: finance.userId },
    });
    expect(sent).toMatchObject({
      actorKind: "system",
      before: { status: "approved" },
      after: { status: "processing", attempt: 1 },
    });
    expect(done).toMatchObject({
      before: { status: "processing" },
      after: {
        status: "refunded",
        registrationsRefunded: [...paid.registrationIds].sort(),
      },
    });

    // Draining again sends nothing more.
    await h.drain();
    expect(h.gateway.refunds).toHaveLength(1);
  });

  it("refunds only the listed students; the others stay confirmed", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 5 });
    const ids = [...paid.registrationIds].sort();
    const { refundId } = await requested(h, paid, [ids[1]!, ids[3]!]);
    const finance = await signInStaff(h, "finance");

    await h.as(finance.actor).approveRefund({ refundId });
    await h.drain();

    expect(h.gateway.refunds[0]?.amountMinor).toBe(FEE_PAISE * 2n);
    expect(await statusesOf(h, ids)).toEqual([
      "confirmed",
      "refunded",
      "confirmed",
      "refunded",
      "confirmed",
    ]);
  });

  it("decides a refund once", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);
    const { refundId } = await requested(h, paid);
    const finance = await signInStaff(h, "finance");
    await h.as(finance.actor).approveRefund({ refundId });

    expect(await h.as(finance.actor).approveRefund({ refundId })).toEqual({
      ok: false,
      error: "not_requested",
    });
    expect(
      await h
        .as(finance.actor)
        .rejectRefund({ refundId, note: "Changed my mind." })
    ).toEqual({ ok: false, error: "not_rejectable" });
  });
});

describe("rejectRefund", () => {
  it("rejects with a note: no gateway call, the students are free to be asked for again", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);
    const { refundId } = await requested(h, paid);
    const finance = await signInStaff(h, "finance");

    expect(
      await h.as(finance.actor).rejectRefund({ refundId, note: "   " })
    ).toEqual({ ok: false, error: "note_required" });
    expect(
      await h
        .as(finance.actor)
        .rejectRefund({ refundId, note: "Outside the refund policy." })
    ).toEqual({ ok: true, status: "rejected" });

    expect(await refundRow(h, refundId)).toMatchObject({
      status: "rejected",
      decidedBy: finance.userId,
      decisionNote: "Outside the refund policy.",
    });
    for (const item of await refundItemsOf(h, refundId)) {
      expect(item.releasedAt).toEqual(h.clock.now());
    }
    expect((await refundAudit(h)).at(-1)).toMatchObject({
      action: "refund.rejected",
      actorRole: "finance",
      before: { status: "requested" },
      after: { status: "rejected" },
    });
    await h.drain();
    expect(h.gateway.refunds).toHaveLength(0);
    expect(await statusesOf(h, paid.registrationIds)).toEqual([
      "confirmed",
      "confirmed",
    ]);
    // Asking again works: the rejected refund let the students go.
    expect((await requested(h, paid)).refundId).not.toBe(refundId);
  });

  it("needs a fresh second factor too", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);
    const { refundId } = await requested(h, paid);
    const finance = await signInStaff(h, "finance");
    h.clock.advance({ minutes: 11 });

    await expect(
      h.as(finance.actor).rejectRefund({ refundId, note: "Not allowed." })
    ).rejects.toMatchObject({ code: "step_up_required" });
    expect((await refundRow(h, refundId)).status).toBe("requested");
  });
});

describe("separation of duties", () => {
  it("never lets the requester approve or reject their own request, even holding finance", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);
    const both = await h.seed.member();
    await h.seed.grant(both, { role: "staff_admin", scope: { type: "global" } });
    await h.seed.grant(both, { role: "finance", scope: { type: "global" } });
    const actor = await h.signIn(both);
    const asked = await h
      .as(actor)
      .requestRefund({ batchId: paid.batchId, reason: REASON });
    if (!asked.ok) throw new Error("not asked");
    const before = await refundRows(h);

    expect(
      await h.as(actor).approveRefund({ refundId: asked.refundId })
    ).toEqual({ ok: false, error: "same_person" });
    expect(
      await h
        .as(actor)
        .rejectRefund({ refundId: asked.refundId, note: "Not mine to do." })
    ).toEqual({ ok: false, error: "same_person" });
    expect(await refundRows(h)).toEqual(before);
  });
});

describe("who may decide", () => {
  it("lets finance decide, and refuses a competition manager, a staff admin and a super admin", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);
    const { refundId } = await requested(h, paid);
    const refused = [
      (await signInManager(h, "global")).actor,
      (await signInStaff(h, "staff_admin")).actor,
      (await signInStaff(h, "super_admin")).actor,
      paid.school.coordinator.actor,
    ];

    for (const actor of refused) {
      await expect(
        h.as(actor).approveRefund({ refundId })
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        h.as(actor).rejectRefund({ refundId, note: "No." })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await h.db.select().from(outbox)).not.toContainEqual(
      expect.objectContaining({ eventType: "refund.approved" })
    );
    const finance = await signInStaff(h, "finance");
    expect(await h.as(finance.actor).approveRefund({ refundId })).toEqual({
      ok: true,
      status: "approved",
    });
    expect((await h.db.select().from(refund))[0]?.status).toBe("approved");
  });
});
