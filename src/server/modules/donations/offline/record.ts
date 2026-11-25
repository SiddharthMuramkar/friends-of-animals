// Finance's offline gifts (#108). A private, completed proof is reserved by
// its file row lock; saving the same proof twice cannot create two gifts.
// The receipt is numbered in the same transaction as the gift and its event.
import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { donation, donor, fileAsset } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { invalidInput, type InvalidInput } from "../../../input";
import { emit } from "../../../outbox/emit";
import { normaliseEmailAddress } from "../../../ports/email";
import type { UseCaseContext } from "../../../use-cases";
import { hasCleanScan } from "../../files/use-cases/clean-scan";
import { moduleFileUrl } from "../../files/use-cases/delivery";
import {
  presignUpload,
  type RequestUploadResult,
} from "../../files/use-cases/upload";
import { parseIstDate } from "../../ledger/domain/period";
import {
  checkOfflinePayment,
  istDate,
  OFFLINE_PAYMENT_METHODS,
} from "../../payments/domain/offline-payment";
import { readSetting } from "../../settings/read";
import { initialDonationStatus } from "../domain/donation-status";
import { DONOR_TYPES, givesAsOrganisation } from "../domain/donor";
import { DONOR_PURPOSE, donorEmailHash } from "../donors";
import { normalizePan } from "../domain/pan";
import { issueReceipt } from "../receipts/issue";

const text = (max: number) => z.string().trim().min(1).max(max);
const inputSchema = z.strictObject({
  method: z.enum(OFFLINE_PAYMENT_METHODS),
  reference: z.string().max(200),
  receivedOn: z.string().max(40),
  amountMinor: z.bigint().positive().max(9_223_372_036_854_775_807n),
  donorType: z.enum(DONOR_TYPES),
  name: text(100),
  email: z.string().trim().pipe(z.email().max(254)),
  pan: z.string().max(100).optional(),
  organisationName: z.string().trim().max(120).optional(),
  proofFileId: z.uuid(),
  declaredAdult: z.boolean(),
  declaredIndianSource: z.boolean(),
});

export type RecordOfflineDonationInput = z.input<typeof inputSchema>;
export type RecordOfflineDonationResult =
  | { ok: true; donationId: string; receiptNumber: string }
  | InvalidInput
  | {
      ok: false;
      error:
        | "donations_closed"
        | "proof_invalid"
        | "proof_already_used"
        | "declaration_required";
    };

export async function recordOfflineDonation(
  ctx: UseCaseContext,
  input: RecordOfflineDonationInput
): Promise<RecordOfflineDonationResult> {
  const { role } = await authorize(ctx, "donation.offline.record");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const recordedBy = ctx.actor.userId;
  const given = parsed.data;
  if (!given.declaredAdult || !given.declaredIndianSource)
    return { ok: false, error: "declaration_required" };
  const organisation = givesAsOrganisation(given.donorType);
  if (organisation && !given.organisationName)
    return { ok: false, error: "invalid_input", fields: ["organisationName"] };
  const now = ctx.clock.now();
  const checked = checkOfflinePayment(given, {
    batchAmountMinor: given.amountMinor,
    now,
  });
  if (!checked.ok)
    return {
      ok: false,
      error: "invalid_input",
      fields: Object.keys(checked.errors),
    };
  const received = parseIstDate(given.receivedOn);
  if (!received.ok)
    return { ok: false, error: "invalid_input", fields: ["receivedOn"] };
  return ctx.db.transaction(
    async (tx): Promise<RecordOfflineDonationResult> => {
      if (!(await readSetting(tx, "donations.enabled")))
        return { ok: false, error: "donations_closed" };
      const has80G = await readSetting(tx, "org.has80G");
      const pan = has80G ? normalizePan(given.pan) : null;
      if (has80G && !pan)
        return { ok: false, error: "invalid_input", fields: ["pan"] };
      const [proof] = await tx
        .select()
        .from(fileAsset)
        .where(eq(fileAsset.id, given.proofFileId))
        .for("update");
      if (
        !proof ||
        proof.ownerUserId !== recordedBy ||
        proof.purpose !== "offline_donation_proof" ||
        !["uploaded", "scanning", "clean"].includes(proof.status)
      )
        return { ok: false, error: "proof_invalid" };
      const [used] = await tx
        .select({ id: donation.id })
        .from(donation)
        .where(eq(donation.offlineProofFileId, proof.id));
      if (used) return { ok: false, error: "proof_already_used" };
      const donorId = uuidv7(now);
      const donationId = uuidv7(now);
      const email = normaliseEmailAddress(given.email);
      await tx.insert(donor).values({
        id: donorId,
        type: given.donorType,
        name: ctx.cipher.encrypt(DONOR_PURPOSE.name, given.name),
        pan: pan ? ctx.cipher.encrypt(DONOR_PURPOSE.pan, pan) : null,
        email: ctx.cipher.encrypt(DONOR_PURPOSE.email, email),
        emailHash: donorEmailHash(ctx.blindIndex, email),
        organisationName: organisation ? given.organisationName : null,
        discloseOrganisation: false,
        createdAt: now,
      });
      const status = initialDonationStatus("offline_entry");
      await tx.insert(donation).values({
        id: donationId,
        donorId,
        origin: "offline_entry",
        status,
        amountMinor: given.amountMinor,
        declaredAdult: true,
        declaredIndianSource: true,
        offlineMethod: given.method,
        offlineReference: checked.payment.reference,
        offlineReceivedOn: given.receivedOn,
        offlineProofFileId: proof.id,
        offlineRecordedBy: recordedBy,
        capturedAt: received.start,
        createdAt: now,
        updatedAt: now,
      });
      const issued = await issueReceipt(tx, ctx, {
        donationId,
        donorId,
        amountMinor: given.amountMinor,
        issuedAt: now,
        payment: {
          mode: given.method,
          reference: checked.payment.reference,
          receivedOn: given.receivedOn,
        },
      });
      await recordAudit(tx, ctx, {
        action: "donation.offline_recorded",
        entity: { type: "donation", id: donationId },
        before: null,
        after: {
          status,
          amountMinor: given.amountMinor.toString(),
          method: given.method,
          receivedOn: given.receivedOn,
          proofFileId: proof.id,
          receiptId: issued.id,
        },
        actorRole: role,
      });
      await recordAudit(tx, ctx, {
        action: "receipt.issued",
        entity: { type: "receipt", id: issued.id },
        before: null,
        after: { donationId, number: issued.number },
        actorRole: role,
      });
      await emit(tx, ctx.clock, {
        type: "donation.captured",
        aggregate: { type: "donation", id: donationId },
        payload: { donationId },
      });
      return { ok: true, donationId, receiptNumber: issued.number };
    }
  );
}

const uploadInput = z.strictObject({
  contentType: z.string().max(200),
  sizeBytes: z.number(),
});
export type RequestOfflineDonationProofUploadInput = z.input<
  typeof uploadInput
>;
export async function requestOfflineDonationProofUpload(
  ctx: UseCaseContext,
  input: RequestOfflineDonationProofUploadInput
): Promise<RequestUploadResult | { ok: false; error: "donations_closed" }> {
  await authorize(ctx, "donation.offline.record");
  if (!(await ctx.settings.get("donations.enabled")))
    return { ok: false, error: "donations_closed" };
  const parsed = uploadInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return presignUpload(ctx, ctx.db, {
    ...parsed.data,
    purpose: "offline_donation_proof",
  });
}

export async function getOfflineDonationProof(
  ctx: UseCaseContext,
  input: { donationId: string }
) {
  const { role } = await authorize(ctx, "donation.read");
  const parsed = z.strictObject({ donationId: z.uuid() }).safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const [proof] = await ctx.db
    .select({ file: fileAsset })
    .from(donation)
    .innerJoin(fileAsset, eq(fileAsset.id, donation.offlineProofFileId))
    .where(eq(donation.id, parsed.data.donationId));
  if (!proof || proof.file.purpose !== "offline_donation_proof")
    return { ok: false, error: "not_found" } as const;
  if (!(await hasCleanScan(ctx.storage, proof.file)))
    return { ok: false, error: "file_unavailable" } as const;
  const link = await moduleFileUrl(ctx, proof.file.id);
  if (!link) return { ok: false, error: "file_unavailable" } as const;
  await recordAudit(ctx.db, ctx, {
    action: "donation.offline_proof_read",
    entity: { type: "file_asset", id: proof.file.id },
    before: null,
    after: null,
    actorRole: role,
  });
  return { ok: true, ...link } as const;
}

/** Finance's form options. Reading the form also requires current step-up. */
export async function getOfflineDonationTerms(ctx: UseCaseContext) {
  await authorize(ctx, "donation.offline.record");
  const [open, has80G] = await Promise.all([
    ctx.settings.get("donations.enabled"),
    ctx.settings.get("org.has80G"),
  ]);
  return { open, has80G, today: istDate(ctx.clock.now()) };
}
