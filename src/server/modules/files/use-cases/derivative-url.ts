// Delivering a derivative (#85).
//
//   getFileDerivativeUrl({ fileId, kind }) → whoever may read the file
//                                            (file.read), once it is clean
//
// A derivative has no rules of its own: it is read under its parent file's
// policy and status gate (domain/delivery.ts), served straight from object
// storage through a short-lived signed GET, never from a public URL. Unlike
// the original, the uploader gets no derivative before the scan passes:
// none exists until then.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { can } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { fileDerivative } from "../../../db/schema";
import { DomainError } from "../../../errors";
import { invalidInput, type InvalidInput } from "../../../input";
import { deliveryDecision, type DeliveryRefusal } from "../domain/delivery";
import { DERIVATIVE_KINDS, type DerivativeKind } from "../domain/derivatives";
import { DOWNLOAD_URL_TTL_SECONDS } from "./delivery";
import { findReadableFile } from "./readable-file";
import type { FilesContext } from "./upload";

export type GetFileDerivativeUrlInput = {
  fileId: string;
  kind: DerivativeKind;
};

export type GetFileDerivativeUrlResult =
  | {
      ok: true;
      url: string;
      expiresAt: Date;
      /** For the <img> tag's width and height. */
      width: number;
      height: number;
    }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        /** Not scanned yet, or never deliverable (quarantined, deleted). */
        | Exclude<DeliveryRefusal, "forbidden">
        /** Clean, but its media job is queued, or failed. */
        | "derivative_not_ready";
    };

const KINDS = Object.keys(DERIVATIVE_KINDS) as [
  DerivativeKind,
  ...DerivativeKind[],
];

const getFileDerivativeUrlInput = z.object({
  fileId: z.uuid(),
  kind: z.enum(KINDS),
});

/**
 * A signed URL for one derivative of the file, if its policy and status
 * allow reading the file and the derivative exists. Throws forbidden for a
 * caller the policy refuses, before the file is looked up
 * (./readable-file.ts): only staff who may read every file are told there
 * is none. A read by staff who don't own the file is recorded in the audit
 * log.
 */
export async function getFileDerivativeUrl(
  ctx: FilesContext,
  input: GetFileDerivativeUrlInput
): Promise<GetFileDerivativeUrlResult> {
  const parsed = getFileDerivativeUrlInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { fileId, kind } = parsed.data;
  const file = await findReadableFile(ctx, fileId);
  if (!file) return { ok: false, error: "not_found" };

  // Asked again with the owner, for the role that allows it (the audit) and
  // the status gate, so a caller it refuses learns nothing of the file's
  // status or its derivatives.
  const policy = await can(ctx, "file.read", { ownerId: file.ownerUserId });
  const decision = deliveryDecision({
    status: file.status,
    // Only a clean file has derivatives: the owner's early access to an
    // unscanned original doesn't extend to them.
    isOwner: false,
    authorized: policy.allowed,
  });
  if (!decision.allow) {
    if (decision.reason === "forbidden") {
      throw new DomainError("forbidden", `${ctx.actor.kind} may not file.read`);
    }
    return { ok: false, error: decision.reason };
  }

  const [derivative] = await ctx.db
    .select()
    .from(fileDerivative)
    .where(
      and(eq(fileDerivative.fileAssetId, fileId), eq(fileDerivative.kind, kind))
    );
  if (!derivative || derivative.width === null || derivative.height === null) {
    return { ok: false, error: "derivative_not_ready" };
  }

  const now = ctx.clock.now();
  const { url } = await ctx.storage.presignGet({
    bucket: derivative.bucket,
    key: derivative.storageKey,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    contentType: derivative.contentType,
    disposition: "inline",
    filename: `${file.purpose}-${fileId.slice(0, 8)}-${kind}.webp`,
  });
  // A role allowed it, so the reader isn't the owner: staff looking at a
  // user's picture is on the record, as for the original.
  if (policy.allowed && policy.role !== null) {
    await recordAudit(ctx.db, ctx, {
      action: "file.derivative_read",
      entity: { type: "file_asset", id: fileId },
      before: null,
      after: { kind },
      actorRole: policy.role,
    });
  }
  return {
    ok: true,
    url,
    expiresAt: new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    width: derivative.width,
    height: derivative.height,
  };
}
