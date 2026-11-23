// getOfflinePaymentProof({ batchId }) (#79): a short-lived signed link to
// the proof finance recorded a batch's offline payment with.
//
// A cheque image shows an account number and a signature, so only
// finance, staff admins and super admins may open it (not the payer, who
// holds the original). The file's status still gates it as every file
// (#63): nobody opens a flagged file, and only its uploader opens one
// whose scan hasn't passed. Every read is on the audit log.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { fileAsset, offlinePayment } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import {
  deliveryDecision,
  dispositionFor,
  downloadFilenameFor,
  type DeliveryRefusal,
} from "../files/domain/delivery";
import { DOWNLOAD_URL_TTL_SECONDS } from "../files/use-cases/delivery";

export type GetOfflinePaymentProofInput = { batchId: string };

export type GetOfflinePaymentProofResult =
  | { ok: true; url: string; expiresAt: Date }
  | InvalidInput
  | {
      ok: false;
      error: "not_found" | Exclude<DeliveryRefusal, "forbidden">;
    };

const proofInput = z.object({ batchId: z.uuid() });

export async function getOfflinePaymentProof(
  ctx: UseCaseContext,
  input: GetOfflinePaymentProofInput
): Promise<GetOfflinePaymentProofResult> {
  const { role } = await authorize(ctx, "payments.offline.proof.read");
  const parsed = proofInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const [file] = await ctx.db
    .select({
      id: fileAsset.id,
      ownerUserId: fileAsset.ownerUserId,
      purpose: fileAsset.purpose,
      status: fileAsset.status,
      contentType: fileAsset.contentType,
      bucket: fileAsset.bucket,
      storageKey: fileAsset.storageKey,
    })
    .from(offlinePayment)
    .innerJoin(fileAsset, eq(fileAsset.id, offlinePayment.proofFileAssetId))
    .where(eq(offlinePayment.batchId, parsed.data.batchId));
  if (!file) return { ok: false, error: "not_found" };

  const decision = deliveryDecision({
    status: file.status,
    isOwner: ctx.actor.kind === "user" && ctx.actor.userId === file.ownerUserId,
    authorized: true,
  });
  if (!decision.allow) {
    if (decision.reason === "forbidden") throw new Error("unreachable");
    return { ok: false, error: decision.reason };
  }

  const now = ctx.clock.now();
  const { url } = await ctx.storage.presignGet({
    bucket: file.bucket,
    key: file.storageKey,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    contentType: file.contentType,
    disposition: dispositionFor(file.contentType),
    filename: downloadFilenameFor({
      purpose: file.purpose,
      fileId: file.id,
      contentType: file.contentType,
    }),
  });
  await recordAudit(ctx.db, ctx, {
    action: "payment.offline_proof_read",
    entity: { type: "file_asset", id: file.id },
    before: null,
    after: { batchId: parsed.data.batchId },
    actorRole: role,
  });
  return {
    ok: true,
    url,
    expiresAt: new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000),
  };
}
