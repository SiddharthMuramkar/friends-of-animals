import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  paymentBatch,
  paymentBatchItem,
  registration,
} from "@/server/db/schema";
import { REGISTRATION_NUMBER } from "@/server/modules/registration/domain/registration-number";
import { createHarness } from "@/test/harness";

import { SEED_COORDINATORS } from "./coordinators";
import { SEED_PAYMENTS } from "./payments";
import { SEED_REGISTRATIONS, SEED_STUDENTS } from "./registration";
import { SEED_SCOPES } from "./scopes";

/** The institution's batches; an adult's own is the participants seed's (#78). */
async function batches(h: Awaited<ReturnType<typeof createHarness>>) {
  return h.db
    .select()
    .from(paymentBatch)
    .where(eq(paymentBatch.route, "institution"))
    .orderBy(asc(paymentBatch.id));
}

describe("the payments seed", () => {
  it("adds one paid and one unpaid batch, and running it again changes nothing", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const once = {
      batches: await batches(h),
      items: await h.db.select().from(paymentBatchItem),
      registrations: await h.db.select().from(registration),
    };
    await h.seed.preview();

    expect(once.batches.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: SEED_PAYMENTS.paid.batchId, status: "captured" },
      { id: SEED_PAYMENTS.unpaid.batchId, status: "order_created" },
    ]);
    expect({
      batches: await batches(h),
      items: await h.db.select().from(paymentBatchItem),
      registrations: await h.db.select().from(registration),
    }).toEqual(once);
  });

  it("confirms the paid batch's students in the closed competition, each with a registration number", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const coordinator = await h.signIn(SEED_COORDINATORS.coordinator);

    const paid = await h.as(coordinator).getPaymentBatch({
      institutionId: SEED_SCOPES.institution.id,
      batchId: SEED_PAYMENTS.paid.batchId,
    });

    expect(paid).toMatchObject({
      ok: true,
      batch: {
        status: "captured",
        amount: { amountMinor: 300_000n, currency: "INR" },
        reference: SEED_PAYMENTS.paid.reference,
        competition: { code: "SKIES26" },
        checkout: null,
      },
    });
    const items = paid.ok ? paid.batch.items : [];
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.status).toBe("confirmed");
      expect(item.registrationNumber).toMatch(REGISTRATION_NUMBER);
      expect(item.registrationNumber).toMatch(/^SKIES26-R-/);
    }
  });

  it("holds the open competition's enrolled students in an unpaid order, leaving them enrolled", async () => {
    const h = await createHarness();
    await h.seed.preview();

    const held = await h.db
      .select({ registrationId: paymentBatchItem.registrationId })
      .from(paymentBatchItem)
      .where(eq(paymentBatchItem.batchId, SEED_PAYMENTS.unpaid.batchId));
    const enrolled = SEED_STUDENTS.filter(
      (student) => student.status === "enrolled"
    ).map((student) => student.registrationId);
    expect(held.map((row) => row.registrationId).toSorted()).toEqual(
      enrolled.toSorted()
    );
    const [unpaid] = await h.db
      .select()
      .from(paymentBatch)
      .where(eq(paymentBatch.id, SEED_PAYMENTS.unpaid.batchId));
    expect(unpaid).toMatchObject({
      institutionRegistrationId: SEED_REGISTRATIONS.institution.id,
      amountMinor: 600_000n,
      capturedAt: null,
    });
    const statuses = await h.db
      .select({ status: registration.status })
      .from(registration)
      .where(
        eq(
          registration.institutionRegistrationId,
          SEED_REGISTRATIONS.institution.id
        )
      );
    expect(statuses.filter((row) => row.status === "confirmed")).toEqual([]);
  });
});
