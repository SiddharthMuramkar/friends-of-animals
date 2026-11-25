// Delivering a derivative (#85).
//
//   getFileDerivativeUrl({ fileId, kind }) → whoever may read the file
//                                            (file.read), once it is clean
//
// A derivative is served from private storage through a short-lived signed
// GET after the scan passes. Entry images are delivered through Entries,
// which checks who may see the entry and which image is live.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { can } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { fileAsset, fileDerivative } from "../../../db/schema";
import { DomainError } from "../../../errors";
import { invalidInput, type InvalidInput } from "../../../input";
import { deliveryDecision, type DeliveryRefusal } from "../domain/delivery";
import {
  derivativeExtension,
  STORED_DERIVATIVE_KINDS,
  type StoredDerivativeKind,
} from "../domain/derivatives";
import { DOWNLOAD_URL_TTL_SECONDS } from "./delivery";
import { findReadableFile } from "./readable-file";
import type { FilesContext } from "./upload";

export type GetFileDerivativeUrlInput = {
  fileId: string;
  kind: StoredDerivativeKind;
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

const getFileDerivativeUrlInput = z.object({
  fileId: z.uuid(),
  kind: z.enum(STORED_DERIVATIVE_KINDS),
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

  const signed = await signedDerivative(ctx, file, kind);
  if (!signed) return { ok: false, error: "derivative_not_ready" };
  const { durationMs: _durationMs, ...served } = signed;
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
  return { ok: true, ...served };
}

export type SignedDerivative = {
  url: string;
  expiresAt: Date;
  width: number;
  height: number;
  /** A video's length; null for an image (#86). */
  durationMs: number | null;
};

/**
 * A signed URL for one derivative of `file`, or null if it has none yet.
 * The caller has decided the reader may see it: getFileDerivativeUrl by the
 * file's policy, or a module by its own (an entry's picture, #85, which a
 * guardian may see though another guardian uploaded it).
 */
async function signedDerivative(
  ctx: Pick<FilesContext, "db" | "clock" | "storage">,
  file: { id: string; purpose: string },
  kind: StoredDerivativeKind
): Promise<SignedDerivative | null> {
  const [derivative] = await ctx.db
    .select()
    .from(fileDerivative)
    .where(
      and(
        eq(fileDerivative.fileAssetId, file.id),
        eq(fileDerivative.kind, kind)
      )
    );
  if (!derivative || derivative.width === null || derivative.height === null) {
    return null;
  }
  const now = ctx.clock.now();
  const { url } = await ctx.storage.presignGet({
    bucket: derivative.bucket,
    key: derivative.storageKey,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    contentType: derivative.contentType,
    disposition: "inline",
    filename: `${file.purpose}-${file.id.slice(0, 8)}-${kind}.${derivativeExtension(kind)}`,
  });
  return {
    url,
    expiresAt: new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    width: derivative.width,
    height: derivative.height,
    durationMs: derivative.durationMs,
  };
}

/**
 * For a module that authorized the reader itself: a signed URL for one
 * derivative of a clean file, or null if the file isn't clean or the
 * derivative isn't made yet. Nothing is audited here; the module records
 * staff reads if it must.
 */
export async function moduleDerivativeUrl(
  ctx: Pick<FilesContext, "db" | "clock" | "storage">,
  fileId: string,
  kind: StoredDerivativeKind
): Promise<SignedDerivative | null> {
  const [file] = await ctx.db
    .select({
      id: fileAsset.id,
      purpose: fileAsset.purpose,
      status: fileAsset.status,
    })
    .from(fileAsset)
    .where(eq(fileAsset.id, fileId));
  if (file?.status !== "clean") return null;
  return signedDerivative(ctx, file, kind);
}
