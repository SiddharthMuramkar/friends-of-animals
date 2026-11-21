// Delivering a derivative. Not implemented yet.

import type { DerivativeKind } from "../domain/derivatives";
import type { FilesContext } from "./upload";

export type GetFileDerivativeUrlInput = {
  fileId: string;
  kind: DerivativeKind;
};

export type GetFileDerivativeUrlResult =
  | { ok: true; url: string; expiresAt: Date; width: number; height: number }
  | { ok: false; error: string; fields?: string[] };

export async function getFileDerivativeUrl(
  _ctx: FilesContext,
  _input: GetFileDerivativeUrlInput
): Promise<GetFileDerivativeUrlResult> {
  return { ok: false, error: "not_implemented" };
}
