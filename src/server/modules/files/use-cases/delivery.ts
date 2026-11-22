// Delivering a file (#63).
//
//   getFileDownloadUrl({ fileId }) → the uploader; staff admins and super
//                                    admins once the file is clean
//
// Files are served straight from object storage through a short-lived
// signed GET URL, never through a Vercel function and never from a public
// URL. The policy (`can`) decides who may read the file at all; the status
// gate (domain/delivery.ts) decides what its status allows.
//
// Loads under plain Node: relative imports only, no "server-only".

import { z } from "zod";

import { can } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { DomainError } from "../../../errors";
import { invalidInput, type InvalidInput } from "../../../input";
import {
  deliveryDecision,
  dispositionFor,
  downloadFilenameFor,
  type DeliveryRefusal,
} from "../domain/delivery";
import { findReadableFile } from "./readable-file";
import type { FilesContext } from "./upload";

/** How long a download URL works. */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type GetFileDownloadUrlInput = { fileId: string };

export type GetFileDownloadUrlResult =
  | { ok: true; url: string; expiresAt: Date }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        /** Not scanned yet; only its uploader may open it until then. */
        | Exclude<DeliveryRefusal, "forbidden">;
    };

const getFileDownloadUrlInput = z.object({ fileId: z.uuid() });

/**
 * A signed URL for the file, if the policy and its status allow it.
 * Throws forbidden for a caller the policy refuses, before the file is
 * looked up (./readable-file.ts): only staff who may read every file are
 * told there is none. A read by staff who don't own the file is recorded
 * in the audit log.
 */
export async function getFileDownloadUrl(
  ctx: FilesContext,
  input: GetFileDownloadUrlInput
): Promise<GetFileDownloadUrlResult> {
  const parsed = getFileDownloadUrlInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { fileId } = parsed.data;
  const file = await findReadableFile(ctx, fileId);
  if (!file) return { ok: false, error: "not_found" };

  // Asked again with the owner, for the role that allows it (the audit) and
  // the status gate, so a caller it refuses learns nothing of the status.
  const policy = await can(ctx, "file.read", { ownerId: file.ownerUserId });
  const decision = deliveryDecision({
    status: file.status,
    isOwner: ctx.actor.kind === "user" && ctx.actor.userId === file.ownerUserId,
    authorized: policy.allowed,
  });
  if (!decision.allow) {
    if (decision.reason === "forbidden") {
      throw new DomainError("forbidden", `${ctx.actor.kind} may not file.read`);
    }
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
      fileId,
      contentType: file.contentType,
    }),
  });
  // A role allowed it, so the reader isn't the owner: staff looking at a
  // user's file is on the record.
  if (policy.allowed && policy.role !== null) {
    await recordAudit(ctx.db, ctx, {
      action: "file.read",
      entity: { type: "file_asset", id: fileId },
      before: null,
      after: null,
      actorRole: policy.role,
    });
  }
  return {
    ok: true,
    url,
    expiresAt: new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000),
  };
}
