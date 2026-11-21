// Reading a file's status (#63).
//
//   getFileStatus({ fileId }) → whoever may read the file: its uploader,
//                               staff admins and super admins
//
// The upload page polls it after completing an upload, to show the scan's
// progress and then the download link.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { fileAsset } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { FileStatus } from "../domain/file-status";
import type { FilesContext } from "./upload";

export type GetFileStatusInput = { fileId: string };

export type GetFileStatusResult =
  | { ok: true; fileId: string; status: FileStatus }
  | InvalidInput
  | { ok: false; error: "not_found" };

const getFileStatusInput = z.object({ fileId: z.uuid() });

/** The file's status. Throws forbidden for a caller who may not read it. */
export async function getFileStatus(
  ctx: FilesContext,
  input: GetFileStatusInput
): Promise<GetFileStatusResult> {
  const parsed = getFileStatusInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { fileId } = parsed.data;
  const [file] = await ctx.db
    .select({ ownerUserId: fileAsset.ownerUserId, status: fileAsset.status })
    .from(fileAsset)
    .where(eq(fileAsset.id, fileId));
  if (!file) return { ok: false, error: "not_found" };
  await authorize(ctx, "file.read", { ownerId: file.ownerUserId });
  return { ok: true, fileId, status: file.status };
}
