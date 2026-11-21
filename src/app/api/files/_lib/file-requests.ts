// The files API's requests (not built yet).

import type { UseCases } from "@/server/app";

export type FileAnswer = { status: number; body?: unknown; location?: string };

export type JsonBody =
  | { ok: true; value: unknown }
  | { ok: false; response: FileAnswer };

const notBuilt = (): never => {
  throw new Error("the files API is not built yet");
};

export async function readJson(_request: Request): Promise<JsonBody> {
  return notBuilt();
}

export async function presignRequest(
  _useCases: UseCases,
  _body: JsonBody
): Promise<FileAnswer> {
  return notBuilt();
}

export async function completeRequest(
  _useCases: UseCases,
  _fileId: string
): Promise<FileAnswer> {
  return notBuilt();
}

export async function downloadRequest(
  _useCases: UseCases,
  _fileId: string
): Promise<FileAnswer> {
  return notBuilt();
}

export function toResponse(_answer: FileAnswer): Response {
  return notBuilt();
}
