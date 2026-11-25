import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  donation,
  ledgerPosting,
  receipt,
  receiptLink,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { SEED_DONATIONS } from "./donations";
import { SEED_OFFLINE_DONATION } from "./offline-donations";

async function rows(h: Harness) {
  return {
    donations: await h.db.select().from(donation).orderBy(asc(donation.id)),
    receipts: await h.db.select().from(receipt).orderBy(asc(receipt.seq)),
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
      { id: SEED_OFFLINE_DONATION.donationId, status: "captured" },
    ]);
    expect(once.receipts.map((each) => each.number)).toEqual([
      "FOA-RCPT-2627-000001",
      "FOA-RCPT-2627-000002",
      "FOA-RCPT-2627-000003",
    ]);
    // The ledger seed's reconcile posts them.
    expect(
      once.postings.filter(({ sourceType }) =>
        ["donation", "foreign_donation"].includes(sourceType)
      )
    ).toEqual([
      { sourceType: "donation", sourceId: SEED_DONATIONS.captured.donationId },
      { sourceType: "donation", sourceId: SEED_DONATIONS.csr.donationId },
      { sourceType: "donation", sourceId: SEED_OFFLINE_DONATION.donationId },
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
});
