// Delivering a file (#63).
//
//   getFileDownloadUrl({ fileId }) → the uploader; staff admins and super
//                                    admins once the file is clean.
//   Entry pictures are delivered by Entries as live derivatives.
// Consent forms are available only to staff admins and super admins after
// scanning. Other files also allow uploader access under the status gate.
//
// Files are served straight from object storage through a short-lived
// signed GET URL, never through a Vercel function and never from a public
// URL. The policy (`can`) decides who may read the file at all; the status
// gate (domain/delivery.ts) decides what its status allows.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import { authorize, can } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { fileAsset } from "../../../db/schema";
import { DomainError } from "../../../errors";
import { invalidInput, type InvalidInput } from "../../../input";
import { fileIdInput } from "../inputs";
import {
  deliveryDecision,
  dispositionFor,
  downloadFilenameFor,
  type DeliveryRefusal,
} from "../domain/delivery";
import {
  isFilePurposeAvailable,
  STORABLE_CONTENT_TYPES,
} from "../domain/purposes";
import { hasCleanScan } from "./clean-scan";
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
      error: "not_found" | Exclude<DeliveryRefusal, "forbidden">;
    };

/**
 * A signed URL for the file, if the policy and its status allow it.
 * Throws forbidden for a caller the policy refuses, before the file is
 * looked up (./readable-file.ts): only staff who may read every file are
 * told there is none. Every read granted by a staff role is audited.
 */
export async function getFileDownloadUrl(
  ctx: FilesContext,
  input: GetFileDownloadUrlInput
): Promise<GetFileDownloadUrlResult> {
  const parsed = fileIdInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { fileId } = parsed.data;
  const file = await findReadableFile(ctx, fileId);
  if (!file) return { ok: false, error: "not_found" };

  const signedForm = file.purpose === "consent_form";
  const policy = signedForm
    ? { allowed: true as const, ...(await authorize(ctx, "consent_form.read")) }
    : await can(ctx, "file.read", { ownerId: file.ownerUserId });
  if (signedForm && !isFilePurposeAvailable(file.purpose, ctx.files.appEnv)) {
    return { ok: false, error: "file_unavailable" };
  }
  const decision = deliveryDecision({
    status: file.status,
    isOwner:
      !signedForm &&
      ctx.actor.kind === "user" &&
      ctx.actor.userId === file.ownerUserId,
    authorized: policy.allowed,
  });
  if (!decision.allow) {
    if (decision.reason === "forbidden") {
      throw new DomainError("forbidden", `${ctx.actor.kind} may not file.read`);
    }
    return { ok: false, error: decision.reason };
  }
  if (signedForm && !(await hasCleanScan(ctx.storage, file))) {
    return { ok: false, error: "file_unavailable" };
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

/**
 * For a module that authorized the reader itself (an essay's PDF, which a
 * guardian may read though another guardian uploaded it, #86): a signed
 * URL for a clean file as stored, or null if it isn't clean or isn't a
 * type that is ever served as stored (a video's original never is).
 * Nothing is audited here; the module records staff reads if it must.
 */
export async function moduleFileUrl(
  ctx: Pick<FilesContext, "db" | "clock" | "storage">,
  fileId: string
): Promise<{ url: string; expiresAt: Date } | null> {
  const [file] = await ctx.db
    .select()
    .from(fileAsset)
    .where(eq(fileAsset.id, fileId));
  if (
    file?.status !== "clean" ||
    !(STORABLE_CONTENT_TYPES as readonly string[]).includes(file.contentType)
  ) {
    return null;
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
  return {
    url,
    expiresAt: new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000),
  };
}
