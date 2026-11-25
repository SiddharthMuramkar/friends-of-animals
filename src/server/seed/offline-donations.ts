// #108: a synthetic cash gift with a private demo proof and a numbered
// receipt. Only the preview seed writes this; no messages go out.
import { eq } from "drizzle-orm";
import { donation, donor, fileAsset } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import { DONOR_PURPOSE, donorEmailHash } from "../modules/donations/donors";
import { issueReceipt } from "../modules/donations/receipts/issue";
import { istDate } from "../modules/payments/domain/offline-payment";
import { ensureGrant } from "./access";
import { seedFilesLocation } from "./files";
import { SEED_LEDGER_FINANCE } from "./ledger-periods";
import { ensureSeedAuthenticator } from "./second-factor";
import type { Seeder } from "./types";

export const SEED_OFFLINE_DONATION = {
  donationId: "01938a00-0000-7000-8000-000000108101",
  donorId: "01938a00-0000-7000-8000-000000108111",
  proofId: "01938a00-0000-7000-8000-000000108121",
  name: "Leela Menon",
  email: "leela.donor@example.test",
  amountMinor: 75_000n,
  reference: "FOA-DEMO/001",
} as const;

/** A harmless synthetic 1×1 PNG, not an actual donor's financial document. */
const DEMO_PROOF = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFioAAAAASUVORK5CYII=",
  "base64"
);

export const seedOfflineDonations: Seeder = async (deps) => {
  const { db, clock } = deps;
  const seed = SEED_OFFLINE_DONATION;
  const [already] = await db
    .select({ id: donation.id })
    .from(donation)
    .where(eq(donation.id, seed.donationId));
  if (already) return;
  const finance = await ensureVerifiedAccount(deps, SEED_LEDGER_FINANCE);
  await ensureGrant(deps, finance.id, {
    role: "finance",
    scope: { type: "global" },
  });
  await ensureSeedAuthenticator(deps, finance.id);
  const now = clock.now();
  const { bucket, keyPrefix } = seedFilesLocation();
  const storageKey = storageKeyFor({
    prefix: keyPrefix,
    purpose: "offline_donation_proof",
    fileId: seed.proofId,
  });
  if (deps.storage)
    await deps.storage.write({
      bucket,
      key: storageKey,
      body: DEMO_PROOF,
      contentType: "image/png",
    });
  await db.transaction(async (tx) => {
    await tx.insert(fileAsset).values({
      id: seed.proofId,
      ownerUserId: finance.id,
      purpose: "offline_donation_proof",
      status: "clean",
      contentType: "image/png",
      sizeBytes: DEMO_PROOF.length,
      bucket,
      storageKey,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(donor).values({
      id: seed.donorId,
      type: "individual",
      name: deps.cipher.encrypt(DONOR_PURPOSE.name, seed.name),
      email: deps.cipher.encrypt(DONOR_PURPOSE.email, seed.email),
      emailHash: donorEmailHash(deps.blindIndex, seed.email),
      createdAt: now,
    });
    await tx.insert(donation).values({
      id: seed.donationId,
      donorId: seed.donorId,
      origin: "offline_entry",
      status: "captured",
      amountMinor: seed.amountMinor,
      declaredAdult: true,
      declaredIndianSource: true,
      offlineMethod: "cash",
      offlineReference: seed.reference,
      offlineReceivedOn: istDate(now),
      offlineProofFileId: seed.proofId,
      offlineRecordedBy: finance.id,
      capturedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await issueReceipt(tx, deps, {
      donationId: seed.donationId,
      donorId: seed.donorId,
      amountMinor: seed.amountMinor,
      issuedAt: now,
      payment: {
        mode: "cash",
        reference: seed.reference,
        receivedOn: istDate(now),
      },
    });
  });
};
