// Delivering a file (#63).
//
//   getFileDownloadUrl({ fileId }) → the uploader; staff admins and super
//                                    admins once the file is clean.
//   Entry pictures are delivered by Entries as live derivatives.
// Signed consent forms (#83) and directory listings' documents (#127) are
// staff-only: their module's own rule decides who reads them, after the
// scan, and their uploader is not among them. Other files also allow
// uploader access under the status gate.
//
// Files are served straight from object storage through a short-lived
// signed GET URL, never through a Vercel function and never from a public
// URL. The policy (`can`) decides who may read the file at all; the status
// gate (domain/delivery.ts) decides what its status allows.
//
// Loads under plain Node: relative imports only, no "server-only".

import { authorize, can } from "../../../access/can";
import type { Action } from "../../../access/policies";
import { recordAudit } from "../../../audit/record";
import { DomainError } from "../../../errors";
import { invalidInput, type InvalidInput } from "../../../input";
import { fileIdInput } from "../inputs";
import {
  deliveryDecision,
  dispositionFor,
  downloadFilenameFor,
  type DeliveryRefusal,
} from "../domain/delivery";
import { isFilePurposeAvailable, type FilePurpose } from "../domain/purposes";
import { hasCleanScan } from "./clean-scan";
import { findReadableFile } from "./readable-file";
import type { FilesContext } from "./upload";

/**
 * Purposes only staff read, each through its own module's rule; the
 * uploader's ownership counts for nothing.
 */
const STAFF_READ_ACTIONS: Partial<Record<FilePurpose, Action>> = {
  consent_form: "consent_form.read",
  directory_document: "directory.document.read",
};

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

  const staffAction = STAFF_READ_ACTIONS[file.purpose];
  const staffOnly = staffAction !== undefined;
  const policy = staffOnly
    ? { allowed: true as const, ...(await authorize(ctx, staffAction)) }
    : await can(ctx, "file.read", { ownerId: file.ownerUserId });
  if (staffOnly && !isFilePurposeAvailable(file.purpose, ctx.files.appEnv)) {
    return { ok: false, error: "file_unavailable" };
  }
  const decision = deliveryDecision({
    status: file.status,
    isOwner:
      !staffOnly &&
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
  if (staffOnly && !(await hasCleanScan(ctx.storage, file))) {
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
