// requestUpload and completeUpload (not built yet).

import type { InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { FileStatus } from "../domain/file-status";
import type { FilePurpose, UploadRefusal } from "../domain/purposes";

export type FilesContext = Pick<
  UseCaseContext,
  "db" | "clock" | "actor" | "storage" | "files"
>;

export type RequestUploadInput = {
  purpose: FilePurpose;
  contentType: string;
  sizeBytes: number;
};

export type RequestUploadResult =
  | {
      ok: true;
      fileId: string;
      uploadUrl: string;
      headers: Record<string, string>;
      expiresAt: Date;
    }
  | InvalidInput
  | { ok: false; error: UploadRefusal };

export async function requestUpload(
  _ctx: FilesContext,
  _input: RequestUploadInput
): Promise<RequestUploadResult> {
  throw new Error("requestUpload is not built yet");
}

export type CompleteUploadInput = { fileId: string };

export type CompleteUploadResult =
  | { ok: true; fileId: string; status: FileStatus }
  | InvalidInput
  | { ok: false; error: "not_found" | "upload_missing" | "upload_rejected" };

export async function completeUpload(
  _ctx: FilesContext,
  _input: CompleteUploadInput
): Promise<CompleteUploadResult> {
  throw new Error("completeUpload is not built yet");
}
