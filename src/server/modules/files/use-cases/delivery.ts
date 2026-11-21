// getFileDownloadUrl (not built yet).

import type { InvalidInput } from "../../../input";
import type { DeliveryRefusal } from "../domain/delivery";
import type { FilesContext } from "./upload";

export type GetFileDownloadUrlInput = { fileId: string };

export type GetFileDownloadUrlResult =
  | { ok: true; url: string; expiresAt: Date }
  | InvalidInput
  | { ok: false; error: "not_found" | Exclude<DeliveryRefusal, "forbidden"> };

export async function getFileDownloadUrl(
  _ctx: FilesContext,
  _input: GetFileDownloadUrlInput
): Promise<GetFileDownloadUrlResult> {
  throw new Error("getFileDownloadUrl is not built yet");
}
