import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  donation,
  ledgerPosting,
  receipt,
  receiptLink,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { SEED_RECURRING_CHARGES } from "./recurring-donations";
import {
  SEED_DONATIONS,
  SEED_TRANSPARENCY_DONATIONS,
  SEED_OBJECTIVE_DONATION,
} from "./donations";
import { SEED_OFFLINE_DONATION } from "./offline-donations";

async function rows(h: Harness) {
  return {
    donations: await h.db.select().from(donation).orderBy(asc(donation.id)),
    receipts: await h.db
      .select()
      .from(receipt)
      .orderBy(asc(receipt.fy), asc(receipt.seq)),
    links: await h.db.select().from(receiptLink).orderBy(asc(receiptLink.id)),
    postings: await h.db
      .select({
        sourceType: ledgerPosting.sourceType,
        sourceId: ledgerPosting.sourceId,
      })
      .from(ledgerPosting)
      .orderBy(asc(ledgerPosting.seq)),
  };
}

describe("the donations seed", () => {
  it("adds captured, pending and foreign-refunded donations, and running it again changes nothing", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const once = await rows(h);
    await h.seed.preview();

    expect(once.donations.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: SEED_DONATIONS.captured.donationId, status: "captured" },
      { id: SEED_DONATIONS.csr.donationId, status: "captured" },
      { id: SEED_DONATIONS.pending.donationId, status: "pending" },
      { id: SEED_DONATIONS.foreign.donationId, status: "refunded" },
      ...SEED_RECURRING_CHARGES.map((id) => ({ id, status: "captured" })),
      { id: SEED_OFFLINE_DONATION.donationId, status: "captured" },
      ...SEED_TRANSPARENCY_DONATIONS.map(({ donationId: id }) => ({
        id,
        status: "captured",
      })),
      { id: SEED_OBJECTIVE_DONATION.donationId, status: "refunded" },
    ]);
    expect(once.receipts.map((each) => each.number)).toEqual([
      "FOA-RCPT-2526-000001",
      "FOA-RCPT-2526-000002",
      "FOA-RCPT-2627-000001",
      "FOA-RCPT-2627-000002",
      "FOA-RCPT-2627-000003",
      "FOA-RCPT-2627-000004",
      "FOA-RCPT-2627-000005",
      "FOA-RCPT-2627-000006",
    ]);
    // The ledger seed's reconcile posts them.
    expect(
      once.postings.filter(({ sourceType }) =>
        ["donation", "foreign_donation"].includes(sourceType)
      )
    ).toEqual([
      { sourceType: "donation", sourceId: SEED_DONATIONS.captured.donationId },
      { sourceType: "donation", sourceId: SEED_DONATIONS.csr.donationId },
      ...SEED_RECURRING_CHARGES.map((sourceId) => ({
        sourceId,
        sourceType: "donation",
      })),
      { sourceType: "donation", sourceId: SEED_OFFLINE_DONATION.donationId },
      ...SEED_TRANSPARENCY_DONATIONS.map(({ donationId: sourceId }) => ({
        sourceId,
        sourceType: "donation",
      })),
      { sourceType: "donation", sourceId: SEED_OBJECTIVE_DONATION.donationId },
      { sourceType: "foreign_donation", sourceId: "pay_seed_foreign" },
    ]);
    expect(await rows(h)).toEqual(once);
  });

  it("opens the seeded receipt by its link, and says the old link expired", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const visitor = h.as(h.visitor());

    expect(
      await visitor.getReceiptByToken({
        token: SEED_DONATIONS.captured.receiptToken,
      })
    ).toMatchObject({
      ok: true,
      receipt: { snapshot: { donor: { name: "Priya Sharma" } } },
    });
    expect(
      await visitor.getReceiptByToken({
        token: SEED_DONATIONS.captured.expiredReceiptToken,
      })
    ).toEqual({ ok: false, error: "expired" });
    expect(
      await visitor.getDonationOutcome({
        donationId: SEED_DONATIONS.foreign.donationId,
        checkoutToken: SEED_DONATIONS.foreign.checkoutToken,
      })
    ).toMatchObject({
      ok: true,
      outcome: { status: "refunded", foreignRefund: true },
    });
    const [pending] = await h.db
      .select({ status: donation.status })
      .from(donation)
      .where(eq(donation.id, SEED_DONATIONS.pending.donationId));
    expect(pending?.status).toBe("pending");
  });
  it("seeds a published month with recognised donations rather than sample UI figures", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const visitor = h.as(h.visitor());
    const published = await visitor.getTransparency();
    expect(published).toMatchObject({
      published: true,
      fy: "2025-26",
      months: [
        { month: "2026-03", donationsMinor: 870_000n, spendingMinor: 35_400n },
      ],
      organisations: [{ name: "Demo Community Trust", totalMinor: 750_000n }],
      supporters: ["Demo supporter"],
    });
    expect(await visitor.getFundsRaised()).toEqual({
      fy: "2025-26",
      amountMinor: 870_000n,
      publishedThrough: "2026-03",
    });
    await h.seed.preview();
    expect(await visitor.getTransparency()).toEqual(published);
  });
});
