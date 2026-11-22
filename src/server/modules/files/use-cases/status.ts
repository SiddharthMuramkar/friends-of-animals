// Reading a file's status (#63).
//
//   getFileStatus({ fileId }) → whoever may read the file: its uploader,
//                               staff admins and super admins
//
// The upload page polls it after completing an upload, to show the scan's
// progress and then the download link.
//
// Loads under plain Node: relative imports only, no "server-only".

import { z } from "zod";

import { invalidInput, type InvalidInput } from "../../../input";
import type { FileStatus } from "../domain/file-status";
import { findReadableFile } from "./readable-file";
import type { FilesContext } from "./upload";

export type GetFileStatusInput = { fileId: string };

export type GetFileStatusResult =
  | { ok: true; fileId: string; status: FileStatus }
  | InvalidInput
  | { ok: false; error: "not_found" };

const getFileStatusInput = z.object({ fileId: z.uuid() });

/**
 * The file's status. Throws forbidden for a caller who may not read it,
 * before the file is looked up (./readable-file.ts): a caller who may only
 * read their own files can't tell an id that exists from one that doesn't.
 * Only staff who may read every file are told there is none.
 */
export async function getFileStatus(
  ctx: FilesContext,
  input: GetFileStatusInput
): Promise<GetFileStatusResult> {
  const parsed = getFileStatusInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { fileId } = parsed.data;
  const file = await findReadableFile(ctx, fileId);
  if (!file) return { ok: false, error: "not_found" };
  return { ok: true, fileId, status: file.status };
}
