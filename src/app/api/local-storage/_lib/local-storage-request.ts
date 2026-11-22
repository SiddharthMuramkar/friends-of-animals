// A local run's object storage over HTTP (src/server/ports/storage-disk.ts):
//
//   PUT /api/local-storage/<bucket>/<key>?…signature  → 200, stored
//   GET /api/local-storage/<bucket>/<key>?…signature  → 200, the object
//
// The browser PUTs an upload to, and fetches a download from, the signed
// URLs the disk store issues, as it would from R2. A refusal is 403 (bad
// signature, expired, wrong method, another type or length) or 404 (no
// such object), with no body. Every deployment, and a local run with R2,
// has no disk store: there every request is a 404. Never cached.

import type { DiskRefusal, DiskStorage } from "@/server/ports/storage-disk";

const STATUS_FOR: Readonly<Record<DiskRefusal, number>> = {
  bad_signature: 403,
  expired: 403,
  wrong_method: 403,
  header_mismatch: 403,
  not_found: 404,
};

const NEVER_CACHED = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

const nothing = (status: number) =>
  new Response(null, { status, headers: NEVER_CACHED });

/** The browser's PUT of an upload to a signed URL. */
export async function uploadRequest(
  storage: DiskStorage | null,
  request: Request
): Promise<Response> {
  if (!storage) return nothing(404);
  const result = await storage.receive(
    request.url,
    request.headers,
    request.body
  );
  return nothing(result.ok ? 200 : STATUS_FOR[result.error]);
}

/** The browser's GET of a download's signed URL. */
export async function downloadRequest(
  storage: DiskStorage | null,
  request: Request
): Promise<Response> {
  if (!storage) return nothing(404);
  const result = await storage.serve(request.url);
  if (!result.ok) return nothing(STATUS_FOR[result.error]);
  const headers: Record<string, string> = {
    ...NEVER_CACHED,
    "Content-Length": String(result.sizeBytes),
  };
  if (result.contentType) headers["Content-Type"] = result.contentType;
  if (result.contentDisposition) {
    headers["Content-Disposition"] = result.contentDisposition;
  }
  if (result.cacheControl) headers["Cache-Control"] = result.cacheControl;
  return new Response(result.body, { status: 200, headers });
}
