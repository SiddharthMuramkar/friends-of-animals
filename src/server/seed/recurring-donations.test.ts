import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import {
  recurringDonation,
  donation,
  donor,
  paymentBatch,
} from "@/server/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { SEED_ACCOUNTS } from "./accounts";
import {
  SEED_RECURRING_CHARGES,
  SEED_RECURRING_DONATIONS,
} from "./recurring-donations";

describe("preview recurring donations", () => {
  it("seeds active, past-due and cancelled mandates and two charges idempotently", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const once = await h.db
      .select()
      .from(recurringDonation)
      .orderBy(recurringDonation.id);
    await h.seed.preview();
    expect(
      await h.db.select().from(recurringDonation).orderBy(recurringDonation.id)
    ).toEqual(once);
    expect(once.map((row) => row.status)).toEqual([
      "active",
      "past_due",
      "cancelled",
    ]);
    expect(
      await h.db
        .select()
        .from(donation)
        .where(isNotNull(donation.recurringDonationId))
    ).toHaveLength(2);
  });

  it("links the mandate and its charges to an existing account with the seeded address", async () => {
    const h = await createHarness();
    const member = await h.seed.member({
      email: SEED_ACCOUNTS.members[0].email,
    });
    await h.seed.preview();

    const charges = () =>
      h.db
        .select({
          id: donation.id,
          mandateOwner: recurringDonation.userId,
          donorOwner: donor.userId,
          payer: paymentBatch.payerUserId,
        })
        .from(recurringDonation)
        .innerJoin(
          donation,
          eq(donation.recurringDonationId, recurringDonation.id)
        )
        .innerJoin(donor, eq(donation.donorId, donor.id))
        .innerJoin(paymentBatch, eq(donation.paymentBatchId, paymentBatch.id))
        .where(eq(recurringDonation.id, SEED_RECURRING_DONATIONS[0]))
        .orderBy(donation.id);

    const once = await charges();
    expect(once).toEqual(
      SEED_RECURRING_CHARGES.map((id) => ({
        id,
        mandateOwner: member.id,
        donorOwner: member.id,
        payer: member.id,
      }))
    );

    h.clock.advance({ days: 1 });
    await h.seed.preview();
    expect(await charges()).toEqual(once);
  });
});
