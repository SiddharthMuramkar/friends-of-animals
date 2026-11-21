"use server";

// The upload island's Server Actions. Each one authenticates, validates its
// input and calls one Files use case, which checks can() itself. Return
// values carry only what the island shows: never a row.

import { z } from "zod";

import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { FileStatus } from "@/server/modules/files";

/** Why an upload step failed, as the island words it (files.errors). */
export type UploadError =
  | "signed_out"
  | "too_large"
  | "empty"
  | "type_not_allowed"
  | "purpose_unavailable"
  | "upload_missing"
  | "upload_rejected"
  | "unknown";

export type RequestUploadView =
  | {
      ok: true;
      fileId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    }
  | { ok: false; error: UploadError };

export type FileStatusView =
  | { ok: true; status: FileStatus }
  | { ok: false; error: UploadError };

const uploadRequest = z.object({
  contentType: z.string().max(255),
  sizeBytes: z.int().nonnegative(),
});
const fileId = z.uuid();

async function signedInUser() {
  const actor = await currentActor();
  return actor.kind === "user" ? actor : null;
}

/** Records a pending test upload and presigns its PUT. */
export async function requestUploadAction(
  input: unknown
): Promise<RequestUploadView> {
  const actor = await signedInUser();
  if (!actor) return { ok: false, error: "signed_out" };
  const parsed = uploadRequest.safeParse(input);
  if (!parsed.success) return { ok: false, error: "unknown" };
  const result = await as(actor).requestUpload({
    purpose: "test_upload",
    ...parsed.data,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "invalid_input" ? "unknown" : result.error,
    };
  }
  return {
    ok: true,
    fileId: result.fileId,
    uploadUrl: result.uploadUrl,
    headers: result.headers,
  };
}

/** Confirms the PUT, which sends the file on to its scan. */
export async function completeUploadAction(
  input: unknown
): Promise<FileStatusView> {
  const actor = await signedInUser();
  if (!actor) return { ok: false, error: "signed_out" };
  const parsed = fileId.safeParse(input);
  if (!parsed.success) return { ok: false, error: "unknown" };
  try {
    const result = await as(actor).completeUpload({ fileId: parsed.data });
    if (result.ok) return { ok: true, status: result.status };
    return {
      ok: false,
      error:
        result.error === "upload_missing" || result.error === "upload_rejected"
          ? result.error
          : "unknown",
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: "unknown" };
    throw error;
  }
}

/** Where the file's scan has got to. */
export async function fileStatusAction(
  input: unknown
): Promise<FileStatusView> {
  const actor = await signedInUser();
  if (!actor) return { ok: false, error: "signed_out" };
  const parsed = fileId.safeParse(input);
  if (!parsed.success) return { ok: false, error: "unknown" };
  try {
    const result = await as(actor).getFileStatus({ fileId: parsed.data });
    return result.ok
      ? { ok: true, status: result.status }
      : { ok: false, error: "unknown" };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: "unknown" };
    throw error;
  }
}
