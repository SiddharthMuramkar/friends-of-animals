// The files API (#63), as plain functions over the use cases so they are
// tested at Seam 1; the route handlers only resolve the actor and pass the
// request in.
//
//   POST /api/files/presign        { purpose, contentType, sizeBytes }
//                                  → 201 { fileId, uploadUrl, headers, expiresAt }
//   POST /api/files/[id]/complete  → 200 { fileId, status }
//   GET  /api/files/[id]           → 302 to a 5-minute signed URL
//
// Every refusal is JSON `{ error }` with the status below. Nothing is ever
// cached or indexed. The presign body must be JSON: a cross-site form can't
// send that type without a CORS preflight, which this API never grants, and
// the session cookie is SameSite=Lax besides.

import type { UseCases } from "@/server/app";
import { DomainError } from "@/server/errors";
import { StorageNotConfiguredError } from "@/server/ports/storage";

export type FileAnswer = { status: number; body?: unknown; location?: string };

export type JsonBody =
  | { ok: true; value: unknown }
  | { ok: false; response: FileAnswer };

const STATUS_FOR: Readonly<Record<string, number>> = {
  invalid_input: 400,
  empty: 400,
  purpose_unavailable: 400,
  forbidden: 403,
  not_found: 404,
  /** Not uploaded yet, or not scanned yet: try again later. */
  upload_missing: 409,
  file_not_ready: 409,
  /** Quarantined, rejected or deleted: it won't come back. */
  file_unavailable: 410,
  too_large: 413,
  type_not_allowed: 415,
  upload_rejected: 422,
  storage_unavailable: 503,
};

type Refusal = { ok: false; error: string; fields?: string[] };

function refused({ error, fields }: Refusal): FileAnswer {
  return {
    status: STATUS_FOR[error] ?? 400,
    body: fields ? { error, fields } : { error },
  };
}

/** Reads a JSON request body; another type or bad JSON is answered. */
export async function readJson(request: Request): Promise<JsonBody> {
  const type = request.headers.get("content-type") ?? "";
  if (type.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return {
      ok: false,
      response: { status: 415, body: { error: "json_required" } },
    };
  }
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return {
      ok: false,
      response: { status: 400, body: { error: "invalid_input", fields: [] } },
    };
  }
}

/**
 * Runs a use case call and answers what it throws on purpose: forbidden
 * (403) and storage that isn't configured (503). Anything else is a bug
 * and propagates.
 */
async function answering(run: () => Promise<FileAnswer>): Promise<FileAnswer> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      return refused({ ok: false, error: "forbidden" });
    }
    if (error instanceof StorageNotConfiguredError) {
      return refused({ ok: false, error: "storage_unavailable" });
    }
    throw error;
  }
}

export async function presignRequest(
  useCases: UseCases,
  body: JsonBody
): Promise<FileAnswer> {
  if (!body.ok) return body.response;
  return answering(async () => {
    // The use case parses the input; a wrong shape is its invalid_input.
    const result = await useCases.requestUpload(body.value as never);
    if (!result.ok) return refused(result);
    const { fileId, uploadUrl, headers, expiresAt } = result;
    return {
      status: 201,
      body: { fileId, uploadUrl, headers, expiresAt: expiresAt.toISOString() },
    };
  });
}

export async function completeRequest(
  useCases: UseCases,
  fileId: string
): Promise<FileAnswer> {
  return answering(async () => {
    const result = await useCases.completeUpload({ fileId });
    if (!result.ok) return refused(result);
    return { status: 200, body: { fileId, status: result.status } };
  });
}

export async function downloadRequest(
  useCases: UseCases,
  fileId: string
): Promise<FileAnswer> {
  return answering(async () => {
    const result = await useCases.getFileDownloadUrl({ fileId });
    if (!result.ok) return refused(result);
    return { status: 302, location: result.url };
  });
}

const NEVER_CACHED = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export function toResponse({ status, body, location }: FileAnswer): Response {
  if (location !== undefined) {
    return new Response(null, {
      status,
      headers: {
        ...NEVER_CACHED,
        Location: location,
        // The signed URL must not travel on as a Referer.
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  return Response.json(body ?? null, { status, headers: NEVER_CACHED });
}
