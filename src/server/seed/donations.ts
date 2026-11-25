// Donations seed data (#106), so previews and local runs show the donate
// journey's later pages and finance's list with work in it:
//
// - Captured: a guest's ₹500 with its receipt (numbered by the real
//   counter), a receipt link valid for 7 days from the seed and one that
//   has expired, and its thank-you page's checkout token.
// - Captured: a CSR partner's ₹25,000 that chose to be named, on the
//   donor wall.
// - Pending: a ₹1,000 donation whose checkout was never finished.
// - Foreign: a payment from abroad, refunded in full.
//
// The ledger seed, which runs after this one, posts the captured
// donations and the foreign payment and its return through the nightly
// reconcile. Preview data: it sends nothing and writes no audit entry.
// Every batch names the fake gateway, so no deployed gateway is asked
// about them. Idempotent: a donation already there is left alone. The
// tokens are fixed so journeys can open the pages; they are not secrets
// and open only seeded data.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { eq } from "drizzle-orm";

import { hashLinkToken } from "../crypto/link-token";
import type { AppDb } from "../db/app-db";
import {
  donation,
  donor,
  paymentBatch,
  receiptLink,
  refund,
} from "../db/schema";
import type { DonationStatus } from "../modules/donations/domain/donation-status";
import type { DonorType } from "../modules/donations/domain/donor";
import { RECEIPT_LINK_LIFETIME_MS } from "../modules/donations/domain/receipt-link";
import { DONOR_PURPOSE, donorEmailHash } from "../modules/donations/donors";
import { settleDonationRefund } from "../modules/donations/payments";
import { periodMonthOf } from "../modules/ledger/domain/period";
import { issueReceipt } from "../modules/donations/receipts/issue";
import { isPeriodClosed } from "../modules/ledger/domain/period-lock";
import { loadKnownPeriods } from "../modules/ledger/periods";
import { SEED_LOCKED_MONTH } from "./ledger-periods";
import type { SeedDeps } from "./types";

const token = (fill: string) => fill.repeat(43).slice(0, 43);

export const SEED_DONATIONS = {
  captured: {
    donationId: "01938a00-0000-7000-8000-000000106101",
    donorId: "01938a00-0000-7000-8000-000000106111",
    batchId: "01938a00-0000-7000-8000-000000106121",
    name: "Priya Sharma",
    email: "priya.donor@example.test",
    amountMinor: 50_000n,
    checkoutToken: token("SeedDonationCaptured_"),
    receiptToken: token("SeedReceiptLinkValid_"),
    expiredReceiptToken: token("SeedReceiptLinkOld_"),
  },
  csr: {
    donationId: "01938a00-0000-7000-8000-000000106102",
    donorId: "01938a00-0000-7000-8000-000000106112",
    batchId: "01938a00-0000-7000-8000-000000106122",
    name: "Kavita Iyer",
    email: "csr@acme.example.test",
    organisationName: "Acme Foundation",
    amountMinor: 2_500_000n,
    checkoutToken: token("SeedDonationCsr_"),
  },
  pending: {
    donationId: "01938a00-0000-7000-8000-000000106103",
    donorId: "01938a00-0000-7000-8000-000000106113",
    batchId: "01938a00-0000-7000-8000-000000106123",
    name: "Rahul Verma",
    email: "rahul.donor@example.test",
    amountMinor: 100_000n,
    checkoutToken: token("SeedDonationPending_"),
  },
  foreign: {
    donationId: "01938a00-0000-7000-8000-000000106104",
    donorId: "01938a00-0000-7000-8000-000000106114",
    batchId: "01938a00-0000-7000-8000-000000106124",
    refundId: "01938a00-0000-7000-8000-000000106134",
    name: "Emma Clarke",
    email: "emma.donor@example.test",
    amountMinor: 200_000n,
    checkoutToken: token("SeedDonationForeign_"),
  },
} as const;

type Seeded = {
  donationId: string;
  donorId: string;
  batchId: string;
  name: string;
  email: string;
  amountMinor: bigint;
  checkoutToken: string;
  organisationName?: string;
};

async function insertDonation(
  tx: AppDb,
  deps: SeedDeps,
  seed: Seeded,
  details: {
    type: DonorType;
    status: DonationStatus;
    batchStatus: "order_created" | "captured";
    paymentId: string | null;
    showOnWall: boolean;
    wallName: string | null;
  },
  now: Date
): Promise<void> {
  await tx.insert(donor).values({
    id: seed.donorId,
    userId: null,
    type: details.type,
    name: deps.cipher.encrypt(DONOR_PURPOSE.name, seed.name),
    email: deps.cipher.encrypt(DONOR_PURPOSE.email, seed.email),
    emailHash: donorEmailHash(deps.blindIndex, seed.email),
    organisationName: seed.organisationName ?? null,
    discloseOrganisation: details.type !== "individual",
    createdAt: now,
  });
  const captured = details.batchStatus === "captured";
  await tx.insert(paymentBatch).values({
    id: seed.batchId,
    purpose: "donation",
    route: null,
    competitionId: null,
    payerUserId: null,
    status: details.batchStatus,
    amountMinor: seed.amountMinor,
    currency: "INR",
    gateway: "fake",
    gatewayOrderId: `order_seed_${seed.donationId.slice(-4)}`,
    gatewayPaymentId: captured ? details.paymentId : null,
    captureMethod: captured ? "gateway" : null,
    capturedAt: captured ? now : null,
    createdAt: now,
    updatedAt: now,
  });
  await tx.insert(donation).values({
    id: seed.donationId,
    donorId: seed.donorId,
    origin: "online_checkout",
    status: details.status,
    amountMinor: seed.amountMinor,
    currency: "INR",
    showOnWall: details.showOnWall,
    wallName: details.wallName,
    declaredAdult: true,
    declaredIndianSource: true,
    paymentBatchId: seed.batchId,
    checkoutTokenHash: hashLinkToken(seed.checkoutToken),
    gatewayPaymentId: details.status === "captured" ? details.paymentId : null,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    capturedAt: details.status === "captured" ? now : null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function seedDonations(deps: SeedDeps): Promise<void> {
  const { db, clock } = deps;
  const [already] = await db
    .select({ id: donation.id })
    .from(donation)
    .where(eq(donation.id, SEED_DONATIONS.captured.donationId));
  if (already) return;
  const now = clock.now();

  await db.transaction(async (tx) => {
    const { captured, csr, pending, foreign } = SEED_DONATIONS;
    for (const [seed, type, wallName] of [
      [captured, "individual", null],
      [csr, "csr", csr.organisationName],
    ] as const) {
      const paymentId = `pay_seed_${seed.donationId.slice(-4)}`;
      await insertDonation(
        tx,
        deps,
        seed,
        {
          type,
          status: "captured",
          batchStatus: "captured",
          paymentId,
          showOnWall: wallName !== null,
          wallName,
        },
        now
      );
      const issued = await issueReceipt(tx, deps, {
        donationId: seed.donationId,
        donorId: seed.donorId,
        amountMinor: seed.amountMinor,
        gatewayPaymentId: paymentId,
        issuedAt: now,
      });
      if (seed === captured) {
        await tx.insert(receiptLink).values([
          {
            id: "01938a00-0000-7000-8000-000000106141",
            receiptId: issued.id,
            tokenHash: hashLinkToken(captured.receiptToken),
            issuedTo: "donor",
            createdAt: now,
            expiresAt: new Date(now.getTime() + RECEIPT_LINK_LIFETIME_MS),
          },
          {
            id: "01938a00-0000-7000-8000-000000106142",
            receiptId: issued.id,
            tokenHash: hashLinkToken(captured.expiredReceiptToken),
            issuedTo: "donor",
            createdAt: new Date(now.getTime() - 2 * RECEIPT_LINK_LIFETIME_MS),
            expiresAt: new Date(now.getTime() - RECEIPT_LINK_LIFETIME_MS),
          },
        ]);
      }
    }
    await insertDonation(
      tx,
      deps,
      pending,
      {
        type: "individual",
        status: "pending",
        batchStatus: "order_created",
        paymentId: null,
        showOnWall: false,
        wallName: null,
      },
      now
    );
    await insertDonation(
      tx,
      deps,
      foreign,
      {
        type: "individual",
        status: "refunded",
        batchStatus: "order_created",
        paymentId: null,
        showOnWall: false,
        wallName: null,
      },
      now
    );
    await tx.insert(refund).values({
      id: foreign.refundId,
      batchId: foreign.batchId,
      gatewayPaymentId: "pay_seed_foreign",
      kind: "foreign_payment",
      status: "refunded",
      method: "gateway",
      amountMinor: foreign.amountMinor,
      currency: "INR",
      reason:
        "The donation came from a card outside India, which FOA can't accept while it isn't registered under FCRA. Refunded automatically.",
      requestedAt: now,
      decidedAt: now,
      idempotencyKey: `foreign:${foreign.batchId}:pay_seed_foreign`,
      gatewayRefundId: "rfnd_seed_foreign",
      sentAt: now,
      refundedAt: now,
      updatedAt: now,
    });
  });
}

// Two synthetic historic gifts in the month the period seed publishes.
// Keep today's donation fixtures where they are, for checkout journeys.
export const SEED_TRANSPARENCY_DONATIONS = [
  {
    donationId: "01938a00-0000-7000-8000-000000110201",
    donorId: "01938a00-0000-7000-8000-000000110211",
    batchId: "01938a00-0000-7000-8000-000000110221",
    name: "Demo donor",
    email: "demo.supporter@example.test",
    amountMinor: 120_000n,
    checkoutToken: token("SeedTransparencyIndividual_"),
    type: "individual",
    wallName: "Demo supporter",
  },
  {
    donationId: "01938a00-0000-7000-8000-000000110202",
    donorId: "01938a00-0000-7000-8000-000000110212",
    batchId: "01938a00-0000-7000-8000-000000110222",
    name: "Demo trust contact",
    email: "demo.trust@example.test",
    organisationName: "Demo Community Trust",
    amountMinor: 750_000n,
    checkoutToken: token("SeedTransparencyOrganisation_"),
    type: "csr",
    wallName: null,
  },
] as const;

/** Before the ledger and lock seeds; never add historic gifts to an existing locked ledger. */
export async function seedTransparencyDonations(deps: SeedDeps): Promise<void> {
  const at = new Date(`${SEED_LOCKED_MONTH}-15T10:00:00+05:30`);
  if (at > deps.clock.now()) return;
  await deps.db.transaction(async (tx) => {
    if (isPeriodClosed(SEED_LOCKED_MONTH, await loadKnownPeriods(tx))) return;
    for (const seed of SEED_TRANSPARENCY_DONATIONS) {
      const [existing] = await tx
        .select({ id: donation.id })
        .from(donation)
        .where(eq(donation.id, seed.donationId));
      if (existing) continue;
      const paymentId = `pay_seed_transparency_${seed.donationId.slice(-4)}`;
      await insertDonation(
        tx,
        deps,
        seed,
        {
          type: seed.type,
          status: "captured",
          batchStatus: "captured",
          paymentId,
          showOnWall: seed.wallName !== null,
          wallName: seed.wallName,
        },
        at
      );
      await issueReceipt(tx, deps, {
        donationId: seed.donationId,
        donorId: seed.donorId,
        amountMinor: seed.amountMinor,
        gatewayPaymentId: paymentId,
        issuedAt: at,
      });
    }
  });
}

// A genuine accepted and subsequently returned domestic gift for #135's
// gross/refund/net report. The receipt and its reversal use the normal
// settlement and ledger reconcile seams; no report-only financial record.
export const SEED_OBJECTIVE_DONATION = {
  donationId: "01938a00-0000-7000-8000-000000135101",
  donorId: "01938a00-0000-7000-8000-000000135102",
  batchId: "01938a00-0000-7000-8000-000000135103",
  refundId: "01938a00-0000-7000-8000-000000135104",
  name: "Sample returned donor",
  email: "returned-donation@example.test",
  amountMinor: 25_050n,
  checkoutToken: token("SeedReturnedGift_"),
} as const;

export async function seedObjectiveDonation(deps: SeedDeps): Promise<void> {
  const seed = SEED_OBJECTIVE_DONATION;
  const now = deps.clock.now();
  const capturedAt = new Date(+now - 2 * 86_400_000);
  const returnedAt = new Date(+now - 86_400_000);
  await deps.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: donation.id })
      .from(donation)
      .where(eq(donation.id, seed.donationId));
    if (existing) return;
    const periods = await loadKnownPeriods(tx);
    if (
      isPeriodClosed(periodMonthOf(capturedAt), periods) ||
      isPeriodClosed(periodMonthOf(returnedAt), periods)
    )
      return;
    const paymentId = "pay_seed_135_returned";
    await insertDonation(
      tx,
      deps,
      seed,
      {
        type: "individual",
        status: "captured",
        batchStatus: "captured",
        paymentId,
        showOnWall: false,
        wallName: null,
      },
      capturedAt
    );
    await issueReceipt(tx, deps, {
      donationId: seed.donationId,
      donorId: seed.donorId,
      amountMinor: seed.amountMinor,
      gatewayPaymentId: paymentId,
      issuedAt: capturedAt,
    });
    await tx.insert(refund).values({
      id: seed.refundId,
      batchId: seed.batchId,
      gatewayPaymentId: paymentId,
      kind: "discretionary",
      status: "refunded",
      method: "gateway",
      amountMinor: seed.amountMinor,
      currency: "INR",
      reason: "Demonstration gift returned at donor request",
      requestedAt: returnedAt,
      decidedAt: returnedAt,
      sentAt: returnedAt,
      refundedAt: returnedAt,
      updatedAt: returnedAt,
      gatewayRefundId: "rfnd_seed_135_returned",
    });
    await settleDonationRefund(
      tx,
      {
        clock: { now: () => returnedAt },
        actor: { kind: "system", process: "seed" },
      },
      seed.refundId,
      null
    );
  });
}
