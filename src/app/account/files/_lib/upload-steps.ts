// The upload island's server steps, as plain functions over the use cases
// so they are tested at Seam 1; the Server Actions in ./actions.ts only
// resolve the actor and pass the input in. Each answers with what the
// island shows, never a row, and never rejects for a reason it can name: a
// rejected Server Action would reach the error boundary instead of the
// form. What a use case throws on purpose is answered here, as the files
// API does (src/app/api/files/_lib/file-requests.ts): forbidden, and
// storage this deployment hasn't got. Anything else is a bug and
// propagates, so it is reported.

import { z } from "zod";

import type { UseCases } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { FileStatus } from "@/server/modules/files";
import { StorageNotConfiguredError } from "@/server/ports/storage";

/** Why an upload step failed, as the island words it (files.errors). */
export type UploadError =
  | "signed_out"
  | "too_large"
  | "empty"
  | "type_not_allowed"
  | "purpose_unavailable"
  /** No object storage is configured where this runs. */
  | "storage_unavailable"
  | "upload_missing"
  | "upload_rejected"
  | "unknown";

type Refused = { ok: false; error: UploadError };

export type RequestUploadView =
  | {
      ok: true;
      fileId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    }
  | Refused;

export type FileStatusView = { ok: true; status: FileStatus } | Refused;

export const SIGNED_OUT = { ok: false, error: "signed_out" } as const;

const uploadRequest = z.object({
  contentType: z.string().max(255),
  sizeBytes: z.int().nonnegative(),
});
const fileId = z.uuid();

/** Runs a use case call and answers what it throws on purpose. */
async function answering<View>(
  run: () => Promise<View>
): Promise<View | Refused> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return { ok: false, error: "storage_unavailable" };
    }
    if (error instanceof DomainError) return { ok: false, error: "unknown" };
    throw error;
  }
}

/** Records a pending test upload and presigns its PUT. */
export async function requestUploadStep(
  useCases: UseCases,
  input: unknown
): Promise<RequestUploadView> {
  const parsed = uploadRequest.safeParse(input);
  if (!parsed.success) return { ok: false, error: "unknown" };
  return answering(async (): Promise<RequestUploadView> => {
    const result = await useCases.requestUpload({
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
  });
}

/** Confirms the PUT, which sends the file on to its scan. */
export async function completeUploadStep(
  useCases: UseCases,
  input: unknown
): Promise<FileStatusView> {
  const parsed = fileId.safeParse(input);
  if (!parsed.success) return { ok: false, error: "unknown" };
  return answering(async (): Promise<FileStatusView> => {
    const result = await useCases.completeUpload({ fileId: parsed.data });
    if (result.ok) return { ok: true, status: result.status };
    return {
      ok: false,
      error:
        result.error === "upload_missing" || result.error === "upload_rejected"
          ? result.error
          : "unknown",
    };
  });
}

/** Where the file's scan has got to. */
export async function fileStatusStep(
  useCases: UseCases,
  input: unknown
): Promise<FileStatusView> {
  const parsed = fileId.safeParse(input);
  if (!parsed.success) return { ok: false, error: "unknown" };
  return answering(async (): Promise<FileStatusView> => {
    const result = await useCases.getFileStatus({ fileId: parsed.data });
    return result.ok
      ? { ok: true, status: result.status }
      : { ok: false, error: "unknown" };
  });
}
