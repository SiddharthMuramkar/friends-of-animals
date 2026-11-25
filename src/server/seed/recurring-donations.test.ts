import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { recurringDonation, donation } from "@/server/db/schema";
import { isNotNull } from "drizzle-orm";
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
});
