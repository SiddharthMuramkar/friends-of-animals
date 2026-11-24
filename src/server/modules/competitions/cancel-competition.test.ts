import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import {
  auditLog,
  competition,
  competitionCancellationEmail,
  guardianLink,
  messageDelivery,
  outbox,
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  refund,
  refundItem,
  registration,
  user,
} from "@/server/db/schema";
import { bornYearsAgo } from "@/server/modules/guardians/testing";
import {
  enrol,
  guardianEmail,
  openOrder,
  registrationsOf,
  reviewCasesOf,
  schoolWithStudents,
  signInStaff,
  uploadProof,
  type School,
} from "@/server/modules/payments/testing";
import { refundRow } from "@/server/modules/payments/refunds/testing";
import {
  adultForm,
  openToIndividuals,
  signInMember,
} from "@/server/modules/participants/testing";
import {
  AANYA,
  signInCoordinator,
} from "@/server/modules/registration/testing";
import {
  DEFAULT_RETRY_POLICY,
  drainUntilIdle,
  listFailedDeliveries,
} from "@/server/outbox";
import { EVENT_PAYLOADS } from "@/server/outbox/events";
import { HANDLERS } from "@/server/outbox/handlers";
import { EmailNotConfiguredError } from "@/server/ports/email";
import { sesEmailSender } from "@/server/ports/email-ses";
import { razorpayGateway } from "@/server/ports/razorpay/gateway";
import { fakeRazorpayApi } from "@/server/ports/razorpay/testing";
import { FakeSes } from "@/test/fakes/ses";
import { createHarness, type Harness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";

import { completeFields, signInManager } from "./testing";

// #80 (80b): a super admin cancels a competition behind a fresh second
// factor. In one transaction it is cancelled, requests waiting for finance
// are superseded, one cancellation refund per paid batch is approved by
// the system (80a's funnel sends it from the outbox), unpaid and free
// registrations and open batches are cancelled, and every family contact
// and coordinator is told.

const REASON = "The venue flooded and no other date works for the schools.";
const FEE = 50_000n;

const receive = (h: Harness, orderId: string) =>
  h
    .as(h.visitor())
    .receiveGatewayWebhook(
      h.gateway.webhook({ type: "payment.captured", orderId })
    );

/** Pays the school's enrolled students through the gateway: one batch. */
async function payAndCapture(h: Harness, school: School) {
  const { batchId, orderId } = await openOrder(school);
  h.gateway.capture(orderId);
  const received = await receive(h, orderId);
  if (!received.ok || received.outcome !== "captured") {
    throw new Error(`Not captured: ${JSON.stringify(received)}`);
  }
  return { batchId, orderId };
}

async function acceptReviewedPayment(
  h: Harness,
  school: School,
  amountMinor: bigint,
  historicalCurrency = "INR"
) {
  const { batchId, orderId } = await openOrder(school);
  const { paymentId } = h.gateway.capture(orderId, {
    amount: { amountMinor, currency: historicalCurrency },
  });
  expect(await receive(h, orderId)).toEqual({
    ok: true,
    outcome: "needs_review",
  });
  const [review] = await reviewCasesOf(h, batchId);
  if (!review) throw new Error("No payment review case");
  // Recreate a pre-80b confirmation while keeping the fake provider's receipt.
  const setReceiptCurrency = (currency: string) =>
    h.db
      .update(paymentReviewCase)
      .set({ currency })
      .where(eq(paymentReviewCase.id, review.id));
  if (historicalCurrency !== "INR") await setReceiptCurrency("INR");
  const finance = h.as((await signInStaff(h, "finance")).actor);
  expect(
    await finance.resolvePaymentReviewCase({
      caseId: review.id,
      outcome: "confirm",
      reason: "The school confirmed the amount on their receipt.",
    })
  ).toEqual({ ok: true, batchStatus: "captured" });
  if (historicalCurrency !== "INR")
    await setReceiptCurrency(historicalCurrency);
  return { batchId, orderId, paymentId, finance, caseId: review.id };
}

/** Enrols students `from`..`to` (by fixture number) in the school. */
async function enrolMore(h: Harness, school: School, from: number, to: number) {
  const ids: string[] = [];
  for (let n = from; n <= to; n++) ids.push(await enrol(h, school, n));
  return ids;
}

/** A signed-in super admin, past the second factor just now. */
async function superAdmin(h: Harness) {
  return signInStaff(h, "super_admin");
}

async function competitionRow(h: Harness, competitionId: string) {
  const [row] = await h.db
    .select()
    .from(competition)
    .where(eq(competition.id, competitionId));
  if (!row) throw new Error(`No competition ${competitionId}`);
  return row;
}

async function statusesOf(h: Harness, ids: readonly string[]) {
  return (await registrationsOf(h, ids)).map((row) => row.status);
}

async function cancellationRefunds(h: Harness) {
  return h.db
    .select()
    .from(refund)
    .where(eq(refund.kind, "cancellation"))
    .orderBy(asc(refund.amountMinor));
}

/** Every row a cancellation may change, to compare before and after. */
async function cancellationRows(h: Harness) {
  return {
    competitions: await h.db.select().from(competition).orderBy(competition.id),
    registrations: await h.db
      .select()
      .from(registration)
      .orderBy(registration.id),
    batches: await h.db.select().from(paymentBatch).orderBy(paymentBatch.id),
    items: await h.db
      .select()
      .from(paymentBatchItem)
      .orderBy(paymentBatchItem.batchId, paymentBatchItem.registrationId),
    refunds: await h.db.select().from(refund).orderBy(refund.id),
    refundItems: await h.db
      .select()
      .from(refundItem)
      .orderBy(refundItem.refundId, refundItem.registrationId),
    audit: await h.db.select().from(auditLog).orderBy(asc(auditLog.id)),
    outbox: await h.db.select().from(outbox).orderBy(asc(outbox.id)),
  };
}

async function emailOf(h: Harness, userId: string) {
  const [row] = await h.db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  if (!row?.email) throw new Error(`No email for user ${userId}`);
  return row.email;
}

/** Every email whose subject says the competition was cancelled. */
function cancellationEmails(h: Harness) {
  return h.email.sent.filter((sent) => / is cancelled/.test(sent.subject));
}

describe("cancelCompetition", () => {
  it("cancels with a reason behind a fresh second factor: the status, the instant, the reason and one audit entry", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const admin = await superAdmin(h);

    expect(
      await h.as(admin.actor).cancelCompetition({
        competitionId: school.competition.id,
        reason: `  ${REASON}  `,
      })
    ).toEqual({ ok: true, status: "cancelled" });

    expect(await competitionRow(h, school.competition.id)).toMatchObject({
      status: "cancelled",
      cancelledAt: h.clock.now(),
      cancelReason: REASON,
    });
    const entries = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "competition.cancelled"));
    expect(entries).toEqual([
      expect.objectContaining({
        actorUserId: admin.userId,
        actorRole: "super_admin",
        entityType: "competition",
        entityId: school.competition.id,
        before: { status: "registration_open" },
        after: expect.objectContaining({
          status: "cancelled",
          reason: REASON,
        }),
      }),
    ]);
  });

  it("refuses a second factor passed 10 minutes and 1 second ago, and changes nothing", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    await payAndCapture(h, school);
    const admin = await superAdmin(h);
    h.clock.advance({ minutes: 10, seconds: 1 });
    const before = await cancellationRows(h);

    await expect(
      h.as(admin.actor).cancelCompetition({
        competitionId: school.competition.id,
        reason: REASON,
      })
    ).rejects.toMatchObject({ code: "step_up_required" });

    expect(await cancellationRows(h)).toEqual(before);
    await h.passSecondFactor(admin.actor);
    expect(
      await h.as(admin.actor).cancelCompetition({
        competitionId: school.competition.id,
        reason: REASON,
      })
    ).toEqual({ ok: true, status: "cancelled" });
  });

  it("refunds every gateway-paid batch once, for what it has left, with nobody approving, and every student ends refunded", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const first = await payAndCapture(h, school);
    await enrolMore(h, school, 2, 3);
    const second = await payAndCapture(h, school);
    await enrolMore(h, school, 4, 8);
    const third = await payAndCapture(h, school);
    const students = await h.db
      .select({ id: registration.id })
      .from(registration)
      .where(eq(registration.competitionId, school.competition.id));
    expect(students).toHaveLength(8);
    const admin = await superAdmin(h);

    await h.as(admin.actor).cancelCompetition({
      competitionId: school.competition.id,
      reason: REASON,
    });

    const made = await cancellationRefunds(h);
    expect(
      made.map(({ batchId, status, method, amountMinor }) => ({
        batchId,
        status,
        method,
        amountMinor,
      }))
    ).toEqual([
      {
        batchId: first.batchId,
        status: "approved",
        method: "gateway",
        amountMinor: FEE,
      },
      {
        batchId: second.batchId,
        status: "approved",
        method: "gateway",
        amountMinor: FEE * 2n,
      },
      {
        batchId: third.batchId,
        status: "approved",
        method: "gateway",
        amountMinor: FEE * 5n,
      },
    ]);
    for (const row of made) {
      expect(row).toMatchObject({
        requestedBy: null,
        decidedBy: null,
        reason: REASON,
        idempotencyKey: `cancellation:${school.competition.id}:${row.batchId}`,
      });
    }

    await h.drain();

    expect(
      h.gateway.refunds
        .map((each) => each.amountMinor)
        .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    ).toEqual([FEE, FEE * 2n, FEE * 5n]);
    expect((await cancellationRefunds(h)).map((row) => row.status)).toEqual([
      "refunded",
      "refunded",
      "refunded",
    ]);
    expect(
      await statusesOf(
        h,
        students.map((row) => row.id)
      )
    ).toEqual(Array(8).fill("refunded"));
  });

  it.each(["refused", "failed later", "uncertain"] as const)(
    "reconciles a full-only provider with a %s discretionary attempt",
    async (discretionaryOutcome) => {
      const h = await createHarness();
      const school = await schoolWithStudents(h, { students: 2 });
      const keys = {
        keyId: "rzp_test_foa_fixture",
        keySecret: "fake-key",
        webhookSecret: "fake-webhook",
      };
      const api = fakeRazorpayApi(keys);
      const attempts: { amount: number; key: string | null }[] = [];
      let discretionaryKey: string;
      let canVerifyDiscretionaryFailure = false;
      const gateway = razorpayGateway({
        ...keys,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (
            request.method === "POST" &&
            new URL(request.url).pathname.endsWith("/refund")
          ) {
            const { amount } = (await request.clone().json()) as {
              amount: number;
            };
            const key = request.headers.get("x-refund-idempotency");
            attempts.push({ amount, key });
            if (
              key === discretionaryKey &&
              discretionaryOutcome !== "refused"
            ) {
              if (
                !canVerifyDiscretionaryFailure ||
                discretionaryOutcome === "uncertain"
              ) {
                return new Response(null, { status: 400 });
              }
              const response = await api.fetch(request);
              const failed = (await response.json()) as { id: string };
              api.settleRefund(failed.id, "failed");
              return Response.json({ ...failed, status: "failed" });
            }
            if (amount !== 100_000) {
              return Response.json(
                {
                  error: {
                    code: "BAD_REQUEST_ERROR",
                    description:
                      "Partial refund is currently not supported for this payment method",
                  },
                },
                { status: 400 }
              );
            }
          }
          return api.fetch(request);
        },
      });
      const deps = { ...h.deps, payments: gateway };
      const app = createApp(deps);
      const coordinator = app.as(school.coordinator.actor);
      const order = await coordinator.payInstitutionFees(school.ids);
      if (!order.ok || order.kind !== "checkout") throw new Error("No order");
      const { paymentId, signature } = api.capture(order.checkout.orderId);
      expect(
        await coordinator.confirmCheckout({
          institutionId: school.institutionId,
          batchId: order.batchId,
          paymentId,
          signature,
        })
      ).toEqual({ ok: true, outcome: "captured" });
      const staff = app.as((await signInStaff(h, "staff_admin")).actor);
      const requested = await staff.requestRefund({
        batchId: order.batchId,
        registrationIds: [school.registrationIds[0]!],
        reason: REASON,
      });
      if (!requested.ok) throw new Error(JSON.stringify(requested));
      discretionaryKey = `${requested.refundId}-1`;
      const finance = app.as((await signInStaff(h, "finance")).actor);
      expect(
        await finance.approveRefund({ refundId: requested.refundId })
      ).toEqual({ ok: true, status: "approved" });
      const admin = app.as((await superAdmin(h)).actor);
      const competitionId = school.competition.id;
      expect(
        await admin.cancelCompetition({ competitionId, reason: REASON })
      ).toEqual({ ok: true, status: "cancelled" });
      const [cancellation] = await cancellationRefunds(h);
      if (!cancellation) throw new Error("No cancellation refund");
      await drainUntilIdle(deps, { queue: "all" });
      canVerifyDiscretionaryFailure = true;
      h.clock.advance({ minutes: 5 });
      await drainUntilIdle(deps, { queue: "all" });

      if (discretionaryOutcome === "uncertain") {
        expect(await gateway.fetchRefunds(paymentId)).toEqual([]);
        expect(attempts).toHaveLength(3);
        expect(attempts.filter(({ key }) => key === discretionaryKey)).toEqual([
          { amount: 50_000, key: discretionaryKey },
          { amount: 50_000, key: discretionaryKey },
        ]);
        expect(attempts).toContainEqual({
          amount: 50_000,
          key: `${cancellation.id}-1`,
        });
        expect(
          await finance.getRefund({ refundId: requested.refundId })
        ).toMatchObject({
          refund: { status: "approved", items: [{ released: false }] },
        });
        expect(await cancellationRefunds(h)).toMatchObject([
          { id: cancellation.id, status: "failed", amountMinor: 50_000n },
        ]);
        expect(await statusesOf(h, school.registrationIds)).toEqual([
          "confirmed",
          "confirmed",
        ]);
        return;
      }
      expect(
        (await gateway.fetchRefunds(paymentId)).filter(
          (entry) => entry.status !== "failed"
        )
      ).toMatchObject([{ amountMinor: 100_000n, status: "processed" }]);
      const partialAttempts = discretionaryOutcome === "failed later" ? 3 : 2;
      expect(attempts).toHaveLength(partialAttempts + 1);
      expect(attempts.slice(0, 2)).toEqual(
        expect.arrayContaining([
          { amount: 50_000, key: discretionaryKey },
          { amount: 50_000, key: `${cancellation.id}-1` },
        ])
      );
      if (discretionaryOutcome === "failed later") {
        expect(attempts[2]).toEqual({ amount: 50_000, key: discretionaryKey });
      }
      expect(attempts.at(-1)).toEqual({
        amount: 100_000,
        key: `${cancellation.id}-2`,
      });
      expect(
        await finance.getRefund({ refundId: requested.refundId })
      ).toMatchObject({
        refund: { status: "rejected", supersededByCancellation: true },
      });
      expect(await cancellationRefunds(h)).toMatchObject([
        { id: cancellation.id, status: "refunded", amountMinor: 100_000n },
      ]);
      expect(await statusesOf(h, school.registrationIds)).toEqual([
        "refunded",
        "refunded",
      ]);
    }
  );

  it.each([
    [99_900n, [49_950n, 49_950n], ["refunded", "refunded"]],
    [100_101n, [50_050n, 50_051n], ["refunded", "refunded"]],
    // The student left no share is covered with no paise, and settled (#80).
    [1n, [1n], ["refunded", "refunded"]],
  ])(
    "refunds an accepted capture of %s paise using the reviewed receipt",
    async (amountMinor, allocations, statuses) => {
      const h = await createHarness();
      const school = await schoolWithStudents(h, { students: 2 });
      const { batchId, paymentId, finance } = await acceptReviewedPayment(
        h,
        school,
        amountMinor
      );
      const admin = h.as((await superAdmin(h)).actor);
      const competitionId = school.competition.id;
      expect
        .soft(await admin.getCompetitionCancellation({ competitionId }))
        .toMatchObject({ effects: { refundMinor: amountMinor } });
      expect(
        await admin.cancelCompetition({ competitionId, reason: REASON })
      ).toEqual({ ok: true, status: "cancelled" });
      await h.drain();

      expect(h.gateway.refunds).toMatchObject([
        { paymentId, amountMinor, currency: "INR", status: "processed" },
      ]);
      const [made] = await cancellationRefunds(h);
      expect(made).toMatchObject({ batchId, amountMinor, status: "refunded" });
      expect(await finance.getRefund({ refundId: made!.id })).toMatchObject({
        refund: { batchAmountMinor: amountMinor },
      });
      const items = await h.db
        .select({ amountMinor: refundItem.amountMinor })
        .from(refundItem)
        .where(eq(refundItem.refundId, made!.id))
        .orderBy(refundItem.registrationId);
      expect.soft(items.map((item) => item.amountMinor)).toEqual(allocations);
      expect(await statusesOf(h, school.registrationIds)).toEqual(statuses);
    }
  );

  it("cancels with a historically accepted foreign-currency receipt and refunds the other batch", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const { caseId, paymentId, finance } = await acceptReviewedPayment(
      h,
      school,
      1_200n,
      "USD"
    );
    const otherRegistration = await enrol(h, school, 2);
    await payAndCapture(h, school);
    const admin = h.as((await superAdmin(h)).actor);
    const competitionId = school.competition.id;

    await expect
      .soft(admin.getCompetitionCancellation({ competitionId }))
      .resolves.toMatchObject({
        ok: true,
        effects: {
          gatewayRefunds: 1,
          dashboardRefunds: 1,
          refundMinor: FEE,
          dashboardAmounts: [{ amountMinor: 1_200n, currency: "USD" }],
        },
      });
    await expect(
      admin.cancelCompetition({ competitionId, reason: REASON })
    ).resolves.toEqual({ ok: true, status: "cancelled" });
    await h.drain();
    expect(h.gateway.refunds).toMatchObject([
      { amountMinor: FEE, currency: "INR" },
    ]);
    expect(await statusesOf(h, school.registrationIds)).toEqual(["confirmed"]);
    expect(await statusesOf(h, [otherRegistration])).toEqual(["refunded"]);
    expect(await finance.getPaymentReviewCase({ caseId })).toMatchObject({
      reviewCase: {
        amountMinor: 1_200n,
        currency: "USD",
        resolution: {
          outcome: "confirm",
          refundDue: true,
          manualRefund: "required",
        },
      },
    });
    expect(
      (
        await h.db.select().from(auditLog).where(eq(auditLog.entityId, caseId))
      ).find((entry) => entry.action === "payment.review_resolved")?.after
    ).toMatchObject({ outcome: "confirm" });

    const reference = "rfnd_historical_dashboard";
    h.gateway.addDashboardRefund({
      id: reference,
      paymentId,
      amountMinor: 1_200n,
      currency: "USD",
      status: "processed",
      notes: {},
    });
    expect(await finance.recordDashboardRefund({ caseId, reference })).toEqual({
      ok: true,
    });
    expect(await statusesOf(h, school.registrationIds)).toEqual(["refunded"]);
    expect(await finance.getPaymentReviewCase({ caseId })).toMatchObject({
      reviewCase: {
        resolution: {
          outcome: "confirm",
          refundDue: false,
          manualRefund: "recorded",
        },
      },
    });
    await h.drain();
    const [payer] = await h.db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, school.coordinator.userId));
    expect(
      h.email.sent.filter((mail) => mail.subject.includes("Refund of USD"))
    ).toEqual([
      expect.objectContaining({
        to: payer!.email,
        text: expect.stringContaining(reference),
      }),
    ]);
  });

  it("supersedes a refund approved at the old nominal fee of a reviewed capture, and returns the whole receipt", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const { batchId, caseId, paymentId, finance } = await acceptReviewedPayment(
      h,
      school,
      60_000n
    );
    const staff = h.as((await signInStaff(h, "staff_admin")).actor);
    // The previous implementation allocated the nominal fee, even on a reviewed receipt.
    const setReceiptAmount = (amountMinor: bigint) =>
      h.db
        .update(paymentReviewCase)
        .set({ amountMinor })
        .where(eq(paymentReviewCase.id, caseId));
    await setReceiptAmount(FEE);
    const requested = await staff.requestRefund({ batchId, reason: REASON });
    if (!requested.ok) throw new Error(JSON.stringify(requested));
    expect(
      await finance.approveRefund({ refundId: requested.refundId })
    ).toEqual({ ok: true, status: "approved" });
    await setReceiptAmount(60_000n);
    await h.drain();
    // It no longer accounts for the whole receipt, so it never goes out.
    expect(await refundRow(h, requested.refundId)).toMatchObject({
      status: "failed",
    });
    expect(h.gateway.refunds).toEqual([]);
    expect(await statusesOf(h, school.registrationIds)).toEqual(["confirmed"]);

    const admin = h.as((await superAdmin(h)).actor);
    const competitionId = school.competition.id;
    expect
      .soft(await admin.getCompetitionCancellation({ competitionId }))
      .toMatchObject({
        effects: { gatewayRefunds: 1, refundMinor: 60_000n },
      });
    expect(
      await admin.cancelCompetition({ competitionId, reason: REASON })
    ).toEqual({ ok: true, status: "cancelled" });
    await h.drain();
    await admin.cancelCompetition({ competitionId, reason: REASON });
    await h.drain();

    expect(await refundRow(h, requested.refundId)).toMatchObject({
      status: "rejected",
    });
    expect(h.gateway.refunds).toMatchObject([
      { paymentId, amountMinor: 60_000n },
    ]);
    expect(await cancellationRefunds(h)).toMatchObject([
      { status: "refunded", amountMinor: 60_000n },
    ]);
    expect(await statusesOf(h, school.registrationIds)).toEqual(["refunded"]);
  });

  it("covers a student a one-paise reviewed receipt leaves no share of, and settles both", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { paymentId } = await acceptReviewedPayment(h, school, 1n);
    const [zeroShare] = [...school.registrationIds].sort();
    const admin = h.as((await superAdmin(h)).actor);
    const competitionId = school.competition.id;

    expect(
      await admin.cancelCompetition({ competitionId, reason: REASON })
    ).toEqual({ ok: true, status: "cancelled" });
    expect(await cancellationRefunds(h)).toMatchObject([
      { amountMinor: 1n, zeroShareRegistrationIds: [zeroShare] },
    ]);
    expect(await statusesOf(h, school.registrationIds)).toEqual([
      "confirmed",
      "confirmed",
    ]);
    await h.drain();

    expect(h.gateway.refunds).toMatchObject([{ paymentId, amountMinor: 1n }]);
    expect(await statusesOf(h, school.registrationIds)).toEqual([
      "refunded",
      "refunded",
    ]);
  });

  it("leaves a student an approved refund covers with no paise to that refund", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 3 });
    const { batchId, paymentId, finance } = await acceptReviewedPayment(
      h,
      school,
      2n
    );
    const [zeroShare, unselected, selected] = [
      ...school.registrationIds,
    ].sort();
    const staff = h.as((await signInStaff(h, "staff_admin")).actor);
    const requested = await staff.requestRefund({
      batchId,
      registrationIds: [selected!, zeroShare!],
      reason: REASON,
    });
    expect(requested).toMatchObject({ ok: true, amountMinor: 1n });
    if (!requested.ok) throw new Error(JSON.stringify(requested));
    expect(
      await finance.approveRefund({ refundId: requested.refundId })
    ).toEqual({ ok: true, status: "approved" });
    const admin = h.as((await superAdmin(h)).actor);
    const competitionId = school.competition.id;

    expect(
      await admin.cancelCompetition({ competitionId, reason: REASON })
    ).toEqual({ ok: true, status: "cancelled" });
    const [made] = await cancellationRefunds(h);
    expect(made).toMatchObject({
      amountMinor: 1n,
      zeroShareRegistrationIds: [],
    });
    expect(
      await h.db
        .select({ registrationId: refundItem.registrationId })
        .from(refundItem)
        .where(eq(refundItem.refundId, made!.id))
    ).toEqual([{ registrationId: unselected }]);
    expect(await statusesOf(h, school.registrationIds)).toEqual([
      "confirmed",
      "confirmed",
      "confirmed",
    ]);
    await h.drain();

    expect(h.gateway.refunds).toMatchObject([
      { paymentId, amountMinor: 1n },
      { paymentId, amountMinor: 1n },
    ]);
    expect(await statusesOf(h, school.registrationIds)).toEqual([
      "refunded",
      "refunded",
      "refunded",
    ]);
  });

  it("shows a settled INR duplicate refund against an older USD batch receipt", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const { batchId, orderId, finance } = await acceptReviewedPayment(
      h,
      school,
      1_200n,
      "USD"
    );
    const duplicate = h.gateway.capture(orderId);
    expect(await receive(h, orderId)).toEqual({
      ok: true,
      outcome: "needs_review",
    });
    const cases = await reviewCasesOf(h, batchId);
    const duplicateCase = cases.find(
      (entry) => entry.gatewayPaymentId === duplicate.paymentId
    )!;
    expect(
      await finance.resolvePaymentReviewCase({
        caseId: duplicateCase.id,
        outcome: "refund",
        reason: REASON,
      })
    ).toEqual({ ok: true, batchStatus: "captured" });
    await h.drain();

    const done = await finance.listRefunds({ state: "done" });
    if (!done.ok) throw new Error("Expected the settled duplicate refund");
    expect(done.refunds).toHaveLength(1);
    await expect(
      finance.getRefund({ refundId: done.refunds[0]!.id })
    ).resolves.toMatchObject({
      refund: {
        kind: "duplicate",
        status: "refunded",
        amountMinor: FEE,
        batchAmountMinor: 1_200n,
        batchCurrency: "USD",
      },
    });
  });

  it("subtracts the settled and held amounts from an accepted capture", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 4 });
    const captured = 199_900n;
    const { batchId, paymentId, finance } = await acceptReviewedPayment(
      h,
      school,
      captured
    );
    const staff = h.as((await signInStaff(h, "staff_admin")).actor);
    const [settled, held, requested, available] =
      school.registrationIds.toSorted();
    const ask = async (registrationId: string) => {
      const result = await staff.requestRefund({
        batchId,
        registrationIds: [registrationId],
        reason: "The family moved away.",
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
      return result.refundId;
    };
    await finance.approveRefund({ refundId: await ask(settled!) });
    await h.drain();
    const heldId = await ask(held!);
    await finance.approveRefund({ refundId: heldId });
    h.gateway.answerNextRefund("pending");
    await h.drain();
    const requestedId = await ask(requested!);
    const before = h.gateway.refunds.reduce(
      (sum, row) => sum + row.amountMinor,
      0n
    );
    const admin = h.as((await superAdmin(h)).actor);
    const competitionId = school.competition.id;
    expect
      .soft(await admin.getCompetitionCancellation({ competitionId }))
      .toMatchObject({
        effects: { refundMinor: captured - before },
      });
    expect(
      await admin.cancelCompetition({ competitionId, reason: REASON })
    ).toEqual({
      ok: true,
      status: "cancelled",
    });
    await h.drain();

    expect(h.gateway.refunds).toHaveLength(3);
    expect(h.gateway.refunds.every((row) => row.paymentId === paymentId)).toBe(
      true
    );
    expect(
      h.gateway.refunds.reduce((sum, row) => sum + row.amountMinor, 0n)
    ).toBe(captured);
    expect(await finance.getRefund({ refundId: heldId })).toMatchObject({
      refund: { status: "processing" },
    });
    expect(await finance.getRefund({ refundId: requestedId })).toMatchObject({
      refund: { status: "rejected", supersededByCancellation: true },
    });
    expect(
      await statusesOf(h, [settled!, held!, requested!, available!])
    ).toEqual(["refunded", "confirmed", "refunded", "refunded"]);
  });

  it("refunds only what nobody else is refunding, and takes over a request still waiting for finance", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 3 });
    const { batchId } = await payAndCapture(h, school);
    const [refunded, held, waiting] = [...school.registrationIds].sort();
    const staff = await signInStaff(h, "staff_admin");
    const finance = await signInStaff(h, "finance");
    const ask = async (registrationId: string) => {
      const asked = await h.as(staff.actor).requestRefund({
        batchId,
        registrationIds: [registrationId],
        reason: "The family moved away.",
      });
      if (!asked.ok) throw new Error(JSON.stringify(asked));
      return asked.refundId;
    };
    await h.as(finance.actor).approveRefund({ refundId: await ask(refunded!) });
    await h.drain();
    const heldId = await ask(held!);
    await h.as(finance.actor).approveRefund({ refundId: heldId });
    h.gateway.answerNextRefund("pending");
    await h.drain();
    const waitingId = await ask(waiting!);
    const admin = await superAdmin(h);

    await h.as(admin.actor).cancelCompetition({
      competitionId: school.competition.id,
      reason: REASON,
    });

    const [superseded] = await h.db
      .select()
      .from(refund)
      .where(eq(refund.id, waitingId));
    expect(superseded).toMatchObject({ status: "rejected", decidedBy: null });
    expect(superseded?.decisionNote).toBe("superseded_by_cancellation");
    expect(
      await h.as(finance.actor).getRefund({ refundId: waitingId })
    ).toMatchObject({
      refund: { supersededByCancellation: true },
    });
    const [made] = await cancellationRefunds(h);
    expect(made).toMatchObject({ batchId, amountMinor: FEE });
    expect(
      (
        await h.db
          .select()
          .from(refundItem)
          .where(eq(refundItem.refundId, made!.id))
      ).map((row) => row.registrationId)
    ).toEqual([waiting]);

    await h.drain();

    const live = await h.db
      .select({ amountMinor: refund.amountMinor, status: refund.status })
      .from(refund)
      .where(eq(refund.batchId, batchId));
    const total = live
      .filter((row) => row.status !== "rejected")
      .reduce((sum, row) => sum + row.amountMinor, 0n);
    expect(total).toBeLessThanOrEqual(FEE * 3n);
    expect(await statusesOf(h, [refunded!, held!, waiting!])).toEqual([
      "refunded",
      "confirmed",
      "refunded",
    ]);
    expect(
      (await h.db.select().from(refundItem)).filter(
        (row) => row.registrationId === waiting && row.releasedAt === null
      )
    ).toHaveLength(1);
  });

  it.each(["failed", "definitively_refused"] as const)(
    "returns the whole capture after a discretionary refund was %s by the gateway",
    async (answer) => {
      const h = await createHarness();
      const school = await schoolWithStudents(h, { students: 2 });
      const { batchId } = await payAndCapture(h, school);
      const requester = await signInStaff(h, "staff_admin");
      const finance = h.as((await signInStaff(h, "finance")).actor);
      const asked = await h.as(requester.actor).requestRefund({
        batchId,
        registrationIds: [school.registrationIds[0]!],
        reason: "The family moved away.",
      });
      if (!asked.ok) throw new Error(JSON.stringify(asked));
      expect(await finance.approveRefund({ refundId: asked.refundId })).toEqual(
        {
          ok: true,
          status: "approved",
        }
      );
      h.gateway.answerNextRefund(answer);
      await h.drain();
      expect(
        await finance.getRefund({ refundId: asked.refundId })
      ).toMatchObject({
        refund: { status: "failed" },
      });

      const admin = h.as((await superAdmin(h)).actor);
      const competitionId = school.competition.id;
      expect(
        await admin.cancelCompetition({ competitionId, reason: REASON })
      ).toEqual({
        ok: true,
        status: "cancelled",
      });
      await h.drain();

      expect(
        h.gateway.refunds
          .filter((refund) => refund.status === "processed")
          .map((refund) => refund.amountMinor)
      ).toEqual([FEE * 2n]);
      expect(await statusesOf(h, school.registrationIds)).toEqual([
        "refunded",
        "refunded",
      ]);
      expect(
        await finance.getRefund({ refundId: asked.refundId })
      ).toMatchObject({
        refund: { status: "rejected" },
      });
      expect(await finance.retryRefund({ refundId: asked.refundId })).toEqual({
        ok: false,
        error: "not_failed",
      });
    }
  );

  it("keeps a discretionary refund retryable when it fails after cancellation", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await payAndCapture(h, school);
    const [held, remaining] = school.registrationIds;
    const requester = h.as((await signInStaff(h, "staff_admin")).actor);
    const finance = h.as((await signInStaff(h, "finance")).actor);
    const asked = await requester.requestRefund({
      batchId,
      registrationIds: [held!],
      reason: "The family moved away.",
    });
    if (!asked.ok) throw new Error(JSON.stringify(asked));
    expect(await finance.approveRefund({ refundId: asked.refundId })).toEqual({
      ok: true,
      status: "approved",
    });
    h.gateway.answerNextRefund("pending");
    await h.drain();
    const [pending] = h.gateway.refunds;
    expect(pending).toMatchObject({ amountMinor: FEE, status: "pending" });
    const admin = h.as((await superAdmin(h)).actor);
    expect(
      await admin.cancelCompetition({
        competitionId: school.competition.id,
        reason: REASON,
      })
    ).toEqual({ ok: true, status: "cancelled" });
    await h.drain();
    expect(await statusesOf(h, [held!])).toEqual(["confirmed"]);
    expect(await statusesOf(h, [remaining!])).toEqual(["refunded"]);

    h.gateway.settleRefund(pending!.id, "failed");
    expect(
      await h.as(h.visitor()).receiveGatewayWebhook(
        h.gateway.webhook({
          type: "refund.failed",
          orderId,
          refund: { refundId: pending!.id, paymentId: pending!.paymentId },
        })
      )
    ).toEqual({ ok: true, outcome: "refund_updated" });
    expect(
      await finance.rejectRefund({
        refundId: asked.refundId,
        note: "The gateway attempt failed.",
      })
    ).toEqual({ ok: false, error: "cancellation_refund_required" });
    expect(await finance.getRefund({ refundId: asked.refundId })).toMatchObject(
      {
        refund: {
          status: "failed",
          requiredByCancellation: true,
          items: [{ registrationId: held, released: false }],
        },
      }
    );
    expect(await finance.retryRefund({ refundId: asked.refundId })).toEqual({
      ok: true,
      status: "approved",
    });
    await h.drain();
    expect(await statusesOf(h, school.registrationIds)).toEqual([
      "refunded",
      "refunded",
    ]);
    expect(
      h.gateway.refunds
        .filter((refund) => refund.status === "processed")
        .map((refund) => refund.amountMinor)
    ).toEqual([FEE, FEE]);
  });

  it("leaves cancellation safe to retry if an eligible refund cannot be queued", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId } = await payAndCapture(h, school);
    const requester = await signInStaff(h, "staff_admin");
    expect(
      await h.as(requester.actor).requestRefund({
        batchId,
        registrationIds: [school.registrationIds[0]!],
        reason: "The family moved away.",
      })
    ).toMatchObject({ ok: true });
    // A smaller captured amount cannot cover all of this batch's items.
    await h.db
      .update(paymentBatch)
      .set({ amountMinor: FEE })
      .where(eq(paymentBatch.id, batchId));
    const admin = h.as((await superAdmin(h)).actor);
    const before = await cancellationRows(h);
    const cancel = () =>
      admin.cancelCompetition({
        competitionId: school.competition.id,
        reason: REASON,
      });

    await expect(cancel()).rejects.toThrow(
      "Cannot queue a cancellation refund"
    );
    expect(await cancellationRows(h)).toEqual(before);

    await h.db
      .update(paymentBatch)
      .set({ amountMinor: FEE * 2n })
      .where(eq(paymentBatch.id, batchId));
    expect(await cancel()).toEqual({ ok: true, status: "cancelled" });
    await h.drain();
    expect(h.gateway.refunds.map((refund) => refund.amountMinor)).toEqual([
      FEE * 2n,
    ]);
  });

  it("cancels unpaid registrations and open batches at once, letting their students go, with no refund", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId } = await openOrder(school);
    const [loose] = await enrolMore(h, school, 3, 3);
    const admin = await superAdmin(h);

    await h.as(admin.actor).cancelCompetition({
      competitionId: school.competition.id,
      reason: REASON,
    });

    expect(await statusesOf(h, [...school.registrationIds, loose!])).toEqual([
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
    const [batch] = await h.db
      .select()
      .from(paymentBatch)
      .where(eq(paymentBatch.id, batchId));
    expect(batch?.status).toBe("cancelled");
    expect(
      (
        await h.db
          .select()
          .from(paymentBatchItem)
          .where(eq(paymentBatchItem.batchId, batchId))
      ).every((item) => item.releasedAt !== null)
    ).toBe(true);
    expect(await h.db.select().from(refund)).toEqual([]);
  });

  it("cancels a free competition's confirmed registrations, refunding nothing", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2, feePaise: 0n });
    expect(await school.pay()).toMatchObject({
      ok: true,
      kind: "confirmed_free",
    });
    const admin = await superAdmin(h);

    await h.as(admin.actor).cancelCompetition({
      competitionId: school.competition.id,
      reason: REASON,
    });
    await h.drain();

    expect(await statusesOf(h, school.registrationIds)).toEqual([
      "cancelled",
      "cancelled",
    ]);
    expect(await h.db.select().from(refund)).toEqual([]);
    expect(h.gateway.refunds).toEqual([]);
  });

  it("asks finance to pay an offline-paid batch back by hand: approved, in their queue, no gateway call", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId } = await openOrder(school);
    const finance = await signInStaff(h, "finance");
    const proofFileId = await uploadProof(h, finance.actor, batchId, "clean");
    const recorded = await h.as(finance.actor).recordOfflinePayment({
      batchId,
      method: "cheque",
      reference: "004512",
      amount: "1000",
      receivedOn: "2027-01-15",
      proofFileId,
    });
    if (!recorded.ok) throw new Error(JSON.stringify(recorded));
    const admin = await superAdmin(h);

    await h.as(admin.actor).cancelCompetition({
      competitionId: school.competition.id,
      reason: REASON,
    });
    await h.drain();

    const [made] = await cancellationRefunds(h);
    expect(made).toMatchObject({
      batchId,
      method: "manual",
      status: "approved",
      amountMinor: FEE * 2n,
    });
    expect(h.gateway.refunds).toEqual([]);
    await h.passSecondFactor(finance.actor);
    expect(
      await h.as(finance.actor).listRefunds({ state: "in_progress" })
    ).toMatchObject({ ok: true, refunds: [{ id: made!.id }] });
    expect(await statusesOf(h, school.registrationIds)).toEqual([
      "confirmed",
      "confirmed",
    ]);
  });

  it("tells each registration's family contact once, and each coordinator of each institution once", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    await payAndCapture(h, school);
    await enrolMore(h, school, 3, 3);
    // A second school in the same competition, with one unpaid student.
    const other = await seedInstitution(h, { name: "Other School" });
    const otherCoordinator = await signInCoordinator(h, other.institution.id);
    const registered = await h
      .as(otherCoordinator.actor)
      .registerInstitutionForCompetition({
        institutionId: other.institution.id,
        competitionId: school.competition.id,
      });
    if (!registered.ok) throw new Error(registered.error);
    await enrol(
      h,
      {
        ...school,
        institutionId: other.institution.id,
        reference: registered.reference,
        coordinator: otherCoordinator,
      },
      4
    );
    await h.drain();
    const sentBefore = h.email.sent.length;
    const admin = await superAdmin(h);

    await h.as(admin.actor).cancelCompetition({
      competitionId: school.competition.id,
      reason: REASON,
    });
    await h.drain();

    const told = cancellationEmails(h);
    const coordinators = [
      school.admin.email,
      await emailOf(h, school.coordinator.userId),
      other.admin.email,
      await emailOf(h, otherCoordinator.userId),
    ];
    const families = [1, 2, 3, 4].map(guardianEmail);
    const byAddress = (a: string, b: string) => a.localeCompare(b);
    expect(told.map((sent) => sent.to).toSorted(byAddress)).toEqual(
      [...families, ...coordinators].toSorted(byAddress)
    );
    for (const sent of told) {
      expect(sent.subject).toContain("Paws on the Pavement");
      expect(sent.text).toContain(REASON);
    }
    const paidFamily = told.find((sent) => sent.to === guardianEmail(1));
    expect(paidFamily?.text).toMatch(/refund/i);
    const coordinator = told.find((sent) => sent.to === school.admin.email);
    expect(coordinator?.text).toContain(
      "Please contact any families who did not provide an email address."
    );
    // The payer also hears from 80a once their money is back.
    expect(
      h.email.sent
        .slice(sentBefore)
        .filter((sent) => sent.subject.startsWith("Refund of"))
    ).toHaveLength(1);
  });

  it("delivers an edited family subject on one line and preserves cancellation paragraphs in the body", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const contentManager = await h.seed.member();
    await h.seed.grant(contentManager, {
      role: "content_manager",
      scope: { type: "global" },
    });
    const editor = h.as(await h.signIn(contentManager));
    expect(
      await editor.updateMessageTemplate({
        key: "registration.competition_cancelled",
        channel: "email",
        subject: "Competition cancelled: {{cancellation.reason}}",
        body: "Why: {{cancellation.reason}}\n\nFriends of Animals",
      })
    ).toMatchObject({ ok: true });
    const reason = "The venue flooded.\n\nNo replacement venue is available.";
    const admin = h.as((await superAdmin(h)).actor);
    expect(
      await admin.cancelCompetition({
        competitionId: school.competition.id,
        reason,
      })
    ).toEqual({ ok: true, status: "cancelled" });

    const ses = new FakeSes(h.clock);
    const email = sesEmailSender(
      {
        region: "ap-south-1",
        accessKeyId: "fixture-key-id",
        secretAccessKey: "fixture-key",
        from: "no-reply@example.test",
        configurationSet: "fixture",
      },
      ses.handler
    );
    await drainUntilIdle({ ...h.deps, email }, { queue: "all" });
    expect(ses.inbox(guardianEmail(1))).toMatchObject([
      {
        subject:
          "Competition cancelled: The venue flooded. No replacement venue is available.",
        text: `Why: ${reason}\n\nFriends of Animals`,
      },
    ]);
  });

  it("tells an adult who registered themselves, on their own account", async () => {
    const h = await createHarness();
    const competitionOpen = await openToIndividuals(h);
    const member = await signInMember(h);
    const registered = await h
      .as(member.actor)
      .registerAsIndividual(adultForm(competitionOpen));
    if (!registered.ok) throw new Error(JSON.stringify(registered));
    const admin = await superAdmin(h);

    await h.as(admin.actor).cancelCompetition({
      competitionId: competitionOpen.id,
      reason: REASON,
    });
    await h.drain();

    expect(cancellationEmails(h).map((sent) => sent.to)).toEqual([
      member.email,
    ]);
    expect(await statusesOf(h, [registered.registrationId])).toEqual([
      "cancelled",
    ]);
  });

  it.each(["verified", "revoked"] as const)(
    "checks a %s guardian link when notifying a guardian about a child's cancellation",
    async (link) => {
      const h = await createHarness();
      const competitionOpen = await openToIndividuals(h, {
        fee: 0n,
        ageGroups: [
          { label: "6–12", minAge: 6, maxAge: 12 },
          { label: "Adults", minAge: 18, maxAge: 99 },
        ],
      });
      const family = await h.seed.guardian({
        name: "Kavita Desai",
        email: "kavita@example.test",
        children: [{ fullName: "Meera Desai", age: 9 }],
      });
      const parent = await h.signIn(family.account);
      const {
        fullName: _n,
        dateOfBirth: _d,
        ...form
      } = adultForm(competitionOpen);
      const registered = await h
        .as(parent)
        .registerAsIndividual({ ...form, forChildId: family.childIds[0]! });
      if (!registered.ok) throw new Error(JSON.stringify(registered));
      const admin = await superAdmin(h);

      await h.as(admin.actor).cancelCompetition({
        competitionId: competitionOpen.id,
        reason: REASON,
      });
      if (link === "revoked") {
        await h.db
          .update(guardianLink)
          .set({ revokedAt: h.clock.now() })
          .where(eq(guardianLink.participantProfileId, family.childIds[0]!));
      }
      await h.drain();

      const told = cancellationEmails(h);
      if (link === "verified") {
        expect(told.map((sent) => sent.to)).toEqual(["kavita@example.test"]);
        expect(told[0]?.text).toContain("Hello Kavita Desai");
        expect(told[0]?.text).toContain(
          "Meera Desai's registration is cancelled"
        );
      } else {
        expect(told).toEqual([]);
        expect(await h.as(parent).listInbox()).toEqual([]);
      }
      expect(await statusesOf(h, [registered.registrationId])).toEqual([
        "cancelled",
      ]);
    }
  );

  it.each([
    ["owner", "lost acknowledgement"],
    ["guardian", "lost acknowledgement"],
    ["coordinator", "lost acknowledgement"],
    ["coordinator", "definite rejection"],
  ] as const)(
    "sends one cancellation email to a %s after a %s",
    async (recipient, providerResult) => {
      const h = await createHarness();
      let contact: { competitionId: string; email: string; userId: string };
      if (recipient === "coordinator") {
        const school = await schoolWithStudents(h, { students: 1 });
        contact = {
          competitionId: school.competition.id,
          email: await emailOf(h, school.coordinator.userId),
          userId: school.coordinator.userId,
        };
      } else {
        const target = await openToIndividuals(h, {
          fee: 0n,
          ageGroups: [
            { label: "6–12", minAge: 6, maxAge: 12 },
            { label: "Adults", minAge: 18, maxAge: 99 },
          ],
        });
        const form = adultForm(target);
        if (recipient === "guardian") {
          const family = await h.seed.guardian({
            email: "parent@example.test",
            children: [{ fullName: "Meera Desai", age: 9 }],
          });
          const parent = await h.signIn(family.account);
          const { fullName: _name, dateOfBirth: _dob, ...common } = form;
          expect(
            await h.as(parent).registerAsIndividual({
              ...common,
              forChildId: family.childIds[0]!,
            })
          ).toMatchObject({ ok: true });
          contact = {
            competitionId: target.id,
            email: family.account.email,
            userId: family.account.id,
          };
        } else {
          const adult = await h.seed.member();
          expect(
            await h.as(await h.signIn(adult)).registerAsIndividual(form)
          ).toMatchObject({ ok: true });
          contact = {
            competitionId: target.id,
            email: adult.email,
            userId: adult.id,
          };
        }
      }
      const admin = h.as((await superAdmin(h)).actor);
      expect(
        await admin.cancelCompetition({
          competitionId: contact.competitionId,
          reason: REASON,
        })
      ).toEqual({ ok: true, status: "cancelled" });

      const deliveryIds: (string | undefined)[] = [];
      const deps = {
        ...h.deps,
        email: {
          async send(
            message: Parameters<typeof h.email.send>[0],
            options?: { deliveryId: string }
          ) {
            if (
              message.to === contact.email &&
              message.subject.includes(" is cancelled")
            ) {
              deliveryIds.push(options?.deliveryId);
              if (deliveryIds.length === 1) {
                if (providerResult === "definite rejection") {
                  throw new EmailNotConfiguredError();
                }
                await h.email.send(message);
                throw new Error("The email provider response was lost");
              }
            }
            await h.email.send(message);
          },
        },
      };
      for (let i = 0; i < DEFAULT_RETRY_POLICY.maxAttempts; i++) {
        await drainUntilIdle(deps, { queue: "all" });
        h.clock.advance({ minutes: 5 });
      }

      expect(
        cancellationEmails(h).filter((email) => email.to === contact.email)
      ).toHaveLength(1);
      const [tracked] = await h.db
        .select()
        .from(messageDelivery)
        .where(
          and(
            eq(messageDelivery.userId, contact.userId),
            eq(messageDelivery.channel, "email"),
            eq(
              messageDelivery.templateKey,
              recipient === "owner"
                ? "registration.competition_cancelled_self"
                : recipient === "guardian"
                  ? "registration.competition_cancelled"
                  : "institution_registration.competition_cancelled"
            )
          )
        );
      if (providerResult === "definite rejection") {
        expect(tracked).toMatchObject({ status: "sent", attempts: 2 });
        expect(deliveryIds).toEqual([tracked!.id, tracked!.id]);
        expect(await listFailedDeliveries(h.db)).toEqual([]);
      } else {
        expect(tracked).toMatchObject({ status: "pending", attempts: 1 });
        expect(deliveryIds).toEqual([tracked!.id]);
        expect(await listFailedDeliveries(h.db)).toMatchObject([
          {
            handler: "notifications.dispatch",
            eventId: tracked!.eventId,
            lastError: expect.stringContaining(
              `delivery ${tracked!.id} needs reconciliation`
            ),
          },
        ]);
      }
    }
  );

  it("suppresses a cancellation notice about an unlinked teen waiting for a guardian", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);
    const teen = await h.seed.member({ name: "Meera Iyer" });
    const meera = h.as(await h.signIn(teen));
    const registered = await meera.registerAsIndividual({
      ...adultForm(competition, {
        fullName: "Meera Iyer",
        dateOfBirth: bornYearsAgo(h, 15, 30),
      }),
      guardian: {
        fullName: "Lakshmi Iyer",
        relationship: "parent",
        email: "lakshmi.iyer@example.test",
      },
    });
    if (!registered.ok) throw new Error(JSON.stringify(registered));
    expect(registered.status).toBe("pending_guardian");

    const admin = h.as((await superAdmin(h)).actor);
    expect(
      await admin.cancelCompetition({
        competitionId: competition.id,
        reason: REASON,
      })
    ).toEqual({
      ok: true,
      status: "cancelled",
    });
    await h.drain();

    expect
      .soft(await statusesOf(h, [registered.registrationId]))
      .toEqual(["cancelled"]);
    expect.soft(cancellationEmails(h).map((sent) => sent.to)).toEqual([]);
    expect.soft(await meera.listInbox()).toEqual([]);
    const deliveries = await h.db
      .select({
        channel: messageDelivery.channel,
        status: messageDelivery.status,
        reason: messageDelivery.reason,
      })
      .from(messageDelivery)
      .where(
        and(
          eq(messageDelivery.userId, teen.id),
          eq(messageDelivery.templateKey, "registration.competition_cancelled")
        )
      )
      .orderBy(messageDelivery.channel);
    expect(deliveries).toEqual([
      { channel: "email", status: "suppressed", reason: "no_guardian" },
      { channel: "in_app", status: "suppressed", reason: "no_guardian" },
    ]);
  });

  it("sends one family email if the relay repeats a completed cancellation delivery", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const admin = h.as((await superAdmin(h)).actor);
    expect(
      await admin.cancelCompetition({
        competitionId: school.competition.id,
        reason: REASON,
      })
    ).toEqual({ ok: true, status: "cancelled" });
    const [delivery] = await h.db
      .select()
      .from(outbox)
      .where(eq(outbox.handler, "registration.send_cancellation"));
    if (!delivery) throw new Error("No family cancellation delivery");

    // The handler finished but the relay stopped before saving its result.
    await HANDLERS["registration.send_cancellation"](h.deps, {
      id: delivery.id,
      eventId: delivery.eventId,
      eventType: "registration.competition_cancelled",
      occurredAt: delivery.occurredAt,
      attempt: 1,
      payload: EVENT_PAYLOADS["registration.competition_cancelled"].parse(
        delivery.payload
      ),
    });
    const familyEmails = () =>
      cancellationEmails(h).filter((email) => email.to === guardianEmail(1));
    expect(familyEmails()).toHaveLength(1);
    await h.drain();
    expect(familyEmails()).toHaveLength(1);
  });

  it.each([
    "definitely unsent",
    "uncertain",
    "uncertain and verified unsent",
  ] as const)(
    "recovers a family cancellation email whose send was %s",
    async (outcome) => {
      const h = await createHarness();
      const school = await schoolWithStudents(h, { students: 1 });
      const admin = h.as((await superAdmin(h)).actor);
      expect(
        await admin.cancelCompetition({
          competitionId: school.competition.id,
          reason: REASON,
        })
      ).toEqual({ ok: true, status: "cancelled" });

      let familyAttempts = 0;
      const email = {
        send: async (message: Parameters<typeof h.email.send>[0]) => {
          if (message.to !== guardianEmail(1) || ++familyAttempts > 1) {
            return h.email.send(message);
          }
          if (outcome === "definitely unsent") {
            throw new EmailNotConfiguredError();
          }
          if (outcome === "uncertain and verified unsent") {
            throw new Error("The email provider response was lost");
          }
          await h.email.send(message);
          throw new Error("The email provider response was lost");
        },
      };
      const deps = { ...h.deps, email };
      for (
        let attempt = 0;
        attempt < DEFAULT_RETRY_POLICY.maxAttempts;
        attempt++
      ) {
        await drainUntilIdle(deps, { queue: "all" });
        h.clock.advance({ minutes: 5 });
      }
      const familyEmails = () =>
        cancellationEmails(h).filter(
          (message) => message.to === guardianEmail(1)
        );
      if (outcome === "definitely unsent") {
        expect(familyEmails()).toHaveLength(1);
        expect(familyAttempts).toBe(2);
        expect(await listFailedDeliveries(h.db)).toEqual([]);
      } else {
        expect(familyEmails()).toHaveLength(outcome === "uncertain" ? 1 : 0);
        expect(familyAttempts).toBe(1);
        expect(await listFailedDeliveries(h.db)).toMatchObject([
          {
            handler: "registration.send_cancellation",
            lastError: expect.stringContaining("needs reconciliation"),
          },
        ]);
      }
      if (outcome === "uncertain and verified unsent") {
        const [failed] = await listFailedDeliveries(h.db);
        const [reserved] = await h.db
          .select()
          .from(competitionCancellationEmail)
          .where(eq(competitionCancellationEmail.deliveryId, failed!.id));
        expect(reserved).toEqual({ deliveryId: failed!.id, sentAt: null });
        // The fake provider confirms this attempt was unsent. Recover the
        // same delivery in one transaction, as the worker runbook describes.
        await h.db.transaction(async (tx) => {
          await tx
            .delete(competitionCancellationEmail)
            .where(eq(competitionCancellationEmail.deliveryId, failed!.id));
          await tx
            .update(outbox)
            .set({
              status: "pending",
              attempts: 0,
              availableAt: h.clock.now(),
              lockedUntil: null,
              failedAt: null,
              lastError: null,
            })
            .where(eq(outbox.id, failed!.id));
        });
        await drainUntilIdle(deps, { queue: "all" });
        await drainUntilIdle(deps, { queue: "all" });
        expect(await listFailedDeliveries(h.db)).toEqual([]);
        expect(familyEmails()).toHaveLength(1);
        expect(familyAttempts).toBe(2);
      }
    }
  );

  it("calls no gateway itself: the refunds go from the outbox, and one the gateway refuses goes again later, once", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    await payAndCapture(h, school);
    await enrolMore(h, school, 2, 2);
    await payAndCapture(h, school);
    const admin = await superAdmin(h);

    await h.as(admin.actor).cancelCompetition({
      competitionId: school.competition.id,
      reason: REASON,
    });
    expect(h.gateway.refunds).toHaveLength(0);

    h.gateway.answerNextRefund("refused");
    await h.drain();
    expect(h.gateway.refunds).toHaveLength(1);

    h.clock.advance({ minutes: 5 });
    await h.drain();
    expect(h.gateway.refunds).toHaveLength(2);
    expect(new Set(h.gateway.refunds.map((each) => each.paymentId)).size).toBe(
      2
    );
    expect((await cancellationRefunds(h)).map((row) => row.status)).toEqual([
      "refunded",
      "refunded",
    ]);
  });

  it.each([
    { name: "an empty response", error: undefined, expected: "approved" },
    {
      name: "an unrecognized bad request",
      error: "Please try the refund again later.",
      expected: "approved",
    },
    {
      name: "a definitive refusal",
      error: "The refund amount provided is greater than amount captured",
      expected: "failed",
    },
  ])(
    "settles a Razorpay cancellation after $name",
    async ({ error, expected }) => {
      const h = await createHarness();
      const school = await schoolWithStudents(h, { students: 1 });
      const keys = {
        keyId: "rzp_test_foa_fixture",
        keySecret: "fake-key",
        webhookSecret: "fake-webhook",
      };
      const api = fakeRazorpayApi(keys);
      const idempotencyKeys: (string | null)[] = [];
      const gateway = razorpayGateway({
        ...keys,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (
            request.method === "POST" &&
            new URL(request.url).pathname.endsWith("/refund")
          ) {
            idempotencyKeys.push(request.headers.get("x-refund-idempotency"));
            if (idempotencyKeys.length === 1) {
              return error === undefined
                ? new Response(null, { status: 400 })
                : Response.json(
                    {
                      error: { code: "BAD_REQUEST_ERROR", description: error },
                    },
                    { status: 400 }
                  );
            }
          }
          return api.fetch(request);
        },
      });
      const deps = { ...h.deps, payments: gateway };
      const app = createApp(deps);
      const coordinator = app.as(school.coordinator.actor);
      const order = await coordinator.payInstitutionFees(school.ids);
      if (!order.ok || order.kind !== "checkout") throw new Error("No order");
      const { paymentId, signature } = api.capture(order.checkout.orderId);
      expect(
        await coordinator.confirmCheckout({
          institutionId: school.institutionId,
          batchId: order.batchId,
          paymentId,
          signature,
        })
      ).toEqual({ ok: true, outcome: "captured" });
      const admin = app.as((await superAdmin(h)).actor);
      expect(
        await admin.cancelCompetition({
          competitionId: school.competition.id,
          reason: REASON,
        })
      ).toEqual({ ok: true, status: "cancelled" });
      expect(idempotencyKeys).toEqual([]);

      await drainUntilIdle(deps, { queue: "all" });
      expect(await cancellationRefunds(h)).toMatchObject([
        { status: expected },
      ]);
      expect(await statusesOf(h, school.registrationIds)).toEqual([
        "confirmed",
      ]);
      expect(await gateway.fetchRefunds(paymentId)).toEqual([]);
      expect(idempotencyKeys).toEqual([expect.stringMatching(/\S/)]);

      h.clock.advance({ minutes: 5 });
      await drainUntilIdle(deps, { queue: "all" });
      if (expected === "failed") {
        expect(idempotencyKeys).toHaveLength(1);
        expect(await cancellationRefunds(h)).toMatchObject([
          { status: "failed" },
        ]);
        expect(await gateway.fetchRefunds(paymentId)).toEqual([]);
        return;
      }
      expect(idempotencyKeys).toEqual([idempotencyKeys[0], idempotencyKeys[0]]);
      expect(await gateway.fetchRefunds(paymentId)).toMatchObject([
        { amountMinor: FEE, status: "processed" },
      ]);
      expect(await cancellationRefunds(h)).toMatchObject([
        { status: "refunded" },
      ]);
      expect(await statusesOf(h, school.registrationIds)).toEqual(["refunded"]);
    }
  );

  it("stops the schedule: a cancelled competition never moves again", async () => {
    const h = await createHarness();
    const manager = h.as(await signInManager(h));
    const fields = completeFields();
    const created = await manager.createCompetition({
      ...fields,
      keyDates: { ...fields.keyDates, registration_opens: "2027-02-01T09:00" },
    });
    if (!created.ok) throw new Error(created.error);
    const competitionId = created.competition.id;
    expect(await manager.publishCompetition({ competitionId })).toMatchObject({
      ok: true,
      competition: { status: "published" },
    });
    const jobs = await h.db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.aggregateId, competitionId),
          eq(outbox.eventType, "competitions.key_date_scheduled")
        )
      );
    const opening = jobs.find(
      (job) => job.payload.kind === "registration_opens"
    );
    expect(opening).toMatchObject({ status: "pending", attempts: 0 });
    expect(opening!.availableAt.getTime()).toBeGreaterThan(
      h.clock.now().getTime()
    );
    const admin = await superAdmin(h);
    expect(
      await h.as(admin.actor).cancelCompetition({
        competitionId,
        reason: REASON,
      })
    ).toEqual({ ok: true, status: "cancelled" });

    h.clock.set(opening!.availableAt);
    await h.drain();

    expect(
      await h.db.select().from(outbox).where(eq(outbox.id, opening!.id))
    ).toMatchObject([
      { status: "dispatched", attempts: 1, dispatchedAt: h.clock.now() },
    ]);
    h.clock.advance({ days: 100 });
    await h.drain();
    expect((await competitionRow(h, competitionId)).status).toBe("cancelled");
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "competition.status_changed"))
    ).toEqual([]);
  });

  it("closes registration and payment for good; money still arriving on a cancelled order goes to review", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const { orderId } = await openOrder(school);
    const admin = await superAdmin(h);
    await h.as(admin.actor).cancelCompetition({
      competitionId: school.competition.id,
      reason: REASON,
    });

    expect(
      await h.as(school.coordinator.actor).enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: { ...AANYA, fullName: "Late Student" },
      })
    ).toMatchObject({ ok: false, error: "closed" });
    const late = await seedInstitution(h, { name: "Late School" });
    const lateCoordinator = await signInCoordinator(h, late.institution.id);
    expect(
      await h.as(lateCoordinator.actor).registerInstitutionForCompetition({
        institutionId: late.institution.id,
        competitionId: school.competition.id,
      })
    ).toEqual({ ok: false, error: "closed" });
    expect(await school.pay()).toEqual({ ok: false, error: "nothing_to_pay" });

    h.gateway.capture(orderId);
    await receive(h, orderId);

    expect(await statusesOf(h, school.registrationIds)).toEqual(["cancelled"]);
    const [batch] = await h.db
      .select()
      .from(paymentBatch)
      .where(eq(paymentBatch.gatewayOrderId, orderId));
    expect(batch?.status).toBe("needs_review");
    expect(await reviewCasesOf(h, batch!.id)).toHaveLength(1);
  });

  it("refuses an adult's own registration once cancelled", async () => {
    const h = await createHarness();
    const competitionOpen = await openToIndividuals(h);
    const admin = await superAdmin(h);
    await h.as(admin.actor).cancelCompetition({
      competitionId: competitionOpen.id,
      reason: REASON,
    });
    const member = await signInMember(h);

    expect(
      await h.as(member.actor).registerAsIndividual(adultForm(competitionOpen))
    ).toEqual({ ok: false, error: "registration_closed" });
  });

  it("cancels a draft too", async () => {
    const h = await createHarness();
    const draft = await h.seed.competition();
    const admin = await superAdmin(h);

    expect(
      await h
        .as(admin.actor)
        .cancelCompetition({ competitionId: draft.id, reason: REASON })
    ).toEqual({ ok: true, status: "cancelled" });
    expect(await competitionRow(h, draft.id)).toMatchObject({
      status: "cancelled",
      publishedAt: null,
    });
  });

  it("keeps a cancelled draft private and keeps a previously published cancellation visible", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const draft = await openToIndividuals(h, {
      status: "draft",
      name: "Private draft",
    });
    const published = school.competition;
    const admin = h.as((await superAdmin(h)).actor);
    for (const competition of [draft, published]) {
      expect(
        await admin.cancelCompetition({
          competitionId: competition.id,
          reason: REASON,
        })
      ).toEqual({
        ok: true,
        status: "cancelled",
      });
    }

    const visitor = h.as(h.visitor());
    expect
      .soft(await visitor.publishedCompetitionSlugs())
      .toEqual([published.slug]);
    expect
      .soft(await visitor.getPublishedCompetition({ slug: draft.slug }))
      .toBeNull();
    expect
      .soft(await visitor.getPublishedCompetition({ slug: published.slug }))
      .toMatchObject({ status: "cancelled" });

    const coordinator = h.as(school.coordinator.actor);
    const institutions = await coordinator.listCompetitionsForInstitution({
      institutionId: school.institutionId,
    });
    if (!institutions.ok) throw new Error(institutions.error);
    expect
      .soft(
        institutions.competitions.map(({ slug, window }) => ({ slug, window }))
      )
      .toEqual([{ slug: published.slug, window: "closed" }]);
    expect.soft(await coordinator.listJudgingGuides()).toEqual([
      {
        code: published.code,
        name: "Paws on the Pavement",
        status: "cancelled",
      },
    ]);
    expect
      .soft(await coordinator.getJudgingGuide({ code: draft.code }))
      .toEqual({ ok: false, error: "not_found" });
    expect
      .soft(await coordinator.getJudgingGuide({ code: published.code }))
      .toMatchObject({
        ok: true,
        competition: { status: "cancelled" },
      });
    const member = h.as((await signInMember(h)).actor);
    expect(
      await member.individualRegistrationForm({ competitionSlug: draft.slug })
    ).toBeNull();
  });

  it("keeps registration unavailable after cancelling a draft", async () => {
    const h = await createHarness();
    const draft = await openToIndividuals(h, { status: "draft" });
    const admin = await superAdmin(h);
    expect(
      await h.as(admin.actor).cancelCompetition({
        competitionId: draft.id,
        reason: REASON,
      })
    ).toEqual({ ok: true, status: "cancelled" });

    const member = await signInMember(h);
    const school = await seedInstitution(h, { name: "New School" });
    const coordinator = await signInCoordinator(h, school.institution.id);
    expect
      .soft(await h.as(member.actor).registerAsIndividual(adultForm(draft)))
      .toEqual({ ok: false, error: "not_found" });
    expect(
      await h.as(coordinator.actor).registerInstitutionForCompetition({
        institutionId: school.institution.id,
        competitionId: draft.id,
      })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("authorizes cancellation before it reads any input", async () => {
    const h = await createHarness();
    const member = h.as((await signInMember(h)).actor);
    const input = {
      competitionId: "",
      get reason(): string {
        throw new Error("Cancellation input was read before authorization");
      },
    };
    await expect(member.cancelCompetition(input)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("is final: cancelling again is refused with no new refund, row, audit entry or message", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    await payAndCapture(h, school);
    const admin = await superAdmin(h);
    await h.as(admin.actor).cancelCompetition({
      competitionId: school.competition.id,
      reason: REASON,
    });
    const before = await cancellationRows(h);

    expect(
      await h.as(admin.actor).cancelCompetition({
        competitionId: school.competition.id,
        reason: "Again.",
      })
    ).toEqual({ ok: false, error: "already_cancelled" });
    expect(await cancellationRows(h)).toEqual(before);
  });

  it("needs a reason of 1 to 500 characters, and a competition that exists", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const admin = await superAdmin(h);
    const before = await cancellationRows(h);
    const cancel = (reason: string, competitionId = school.competition.id) =>
      h.as(admin.actor).cancelCompetition({ competitionId, reason });

    expect(await cancel("   ")).toEqual({
      ok: false,
      error: "reason_required",
    });
    expect(await cancel("x".repeat(501))).toEqual({
      ok: false,
      error: "reason_too_long",
    });
    expect(
      await cancel(REASON, "01938a00-0000-7000-8000-00000000ffff")
    ).toEqual({ ok: false, error: "not_found" });
    expect(await cancel(REASON, "not-a-uuid")).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await cancellationRows(h)).toEqual(before);
    expect(await cancel("x".repeat(500))).toEqual({
      ok: true,
      status: "cancelled",
    });
  });

  it("accepts 500 joined graphemes after trimming the cancellation reason", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const admin = h.as((await superAdmin(h)).actor);
    const competitionId = school.competition.id;
    const grapheme = "👩🏽‍❤️‍💋‍👨🏿";
    const reason = grapheme.repeat(500);
    expect
      .soft(
        await admin.cancelCompetition({
          competitionId,
          reason: reason + grapheme,
        })
      )
      .toEqual({ ok: false, error: "reason_too_long" });
    expect(
      await admin.cancelCompetition({ competitionId, reason: ` ${reason} ` })
    ).toEqual({ ok: true, status: "cancelled" });
    expect(await competitionRow(h, competitionId)).toMatchObject({
      cancelReason: reason,
    });
  });

  describe("who may cancel", () => {
    it("lets only a super admin cancel: a competition manager, a staff admin, finance, a coordinator and a member are refused, and nothing changes", async () => {
      const h = await createHarness();
      const school = await schoolWithStudents(h, { students: 1 });
      await payAndCapture(h, school);
      const refused = [
        (await signInStaff(h, "competition_manager")).actor,
        (await signInStaff(h, "staff_admin")).actor,
        (await signInStaff(h, "finance")).actor,
        school.coordinator.actor,
        (await signInStaff(h, null)).actor,
      ];
      const before = await cancellationRows(h);

      for (const actor of refused) {
        await expect(
          h.as(actor).cancelCompetition({
            competitionId: school.competition.id,
            reason: REASON,
          })
        ).rejects.toMatchObject({ code: "forbidden" });
      }
      await expect(
        h.as(h.visitor()).cancelCompetition({
          competitionId: school.competition.id,
          reason: REASON,
        })
      ).rejects.toMatchObject({ code: "forbidden" });

      expect(await cancellationRows(h)).toEqual(before);
    });
  });
});

describe("getCompetitionForEdit's cancel link (#80)", () => {
  it("offers cancelling to a manager who is also a super admin, never to a manager alone, and not once cancelled", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const competitionId = school.competition.id;
    const manager = await signInStaff(h, "competition_manager");
    const both = await h.seed.member();
    await h.seed.grant(both, {
      role: "competition_manager",
      scope: { type: "global" },
    });
    await h.seed.grant(both, {
      role: "super_admin",
      scope: { type: "global" },
    });
    const bothActor = await h.signIn(both);

    expect(
      await h.as(manager.actor).getCompetitionForEdit({ competitionId })
    ).toMatchObject({ ok: true, competition: { mayCancel: false } });
    expect(
      await h.as(bothActor).getCompetitionForEdit({ competitionId })
    ).toMatchObject({ ok: true, competition: { mayCancel: true } });

    await h.as(bothActor).cancelCompetition({ competitionId, reason: REASON });
    expect(
      await h.as(bothActor).getCompetitionForEdit({ competitionId })
    ).toMatchObject({ ok: true, competition: { mayCancel: false } });
  });
});

describe("getCompetitionCancellation", () => {
  it("shows a super admin what cancelling would do, and then what it did", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    await payAndCapture(h, school);
    await enrolMore(h, school, 3, 3);
    const admin = await superAdmin(h);

    expect(
      await h
        .as(admin.actor)
        .getCompetitionCancellation({ competitionId: school.competition.id })
    ).toEqual({
      ok: true,
      competition: {
        id: school.competition.id,
        code: "PAWS27",
        name: "Paws on the Pavement",
        status: "registration_open",
        cancelledAt: null,
        cancelReason: null,
      },
      effects: {
        registrationsTold: 3,
        institutionsTold: 1,
        registrationsCancelled: 1,
        gatewayRefunds: 1,
        manualRefunds: 0,
        dashboardRefunds: 0,
        dashboardAmounts: [],
        refundMinor: FEE * 2n,
      },
    });

    await h.as(admin.actor).cancelCompetition({
      competitionId: school.competition.id,
      reason: REASON,
    });
    expect(
      await h
        .as(admin.actor)
        .getCompetitionCancellation({ competitionId: school.competition.id })
    ).toMatchObject({
      ok: true,
      competition: {
        status: "cancelled",
        cancelledAt: h.clock.now(),
        cancelReason: REASON,
      },
    });
  });

  it("is for super admins only", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    await expect(
      h
        .as((await signInStaff(h, "competition_manager")).actor)
        .getCompetitionCancellation({ competitionId: school.competition.id })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await h.as((await superAdmin(h)).actor).getCompetitionCancellation({
        competitionId: "01938a00-0000-7000-8000-00000000ffff",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});
