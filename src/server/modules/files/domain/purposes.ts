// What may be uploaded, per purpose. A module that takes uploads adds its
// purpose here (and the matching value to the `file_asset_purpose` enum, in a
// migration of its own). The server checks these rules when it presigns an
// upload and again against the stored object, because the browser's
// declaration can't be trusted.

import type { Env } from "@/env.schema";

type AppEnv = Env["APP_ENV"];

const MiB = 1024 * 1024;

export const FILE_PURPOSES = ["test_upload", "directory_document"] as const;

export type FilePurpose = (typeof FILE_PURPOSES)[number];

/**
 * Types the platform will store and serve back. HTML, SVG and other active
 * content are never on this list: a signed URL would serve them from the
 * storage origin.
 */
export const STORABLE_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

export type StorableContentType = (typeof STORABLE_CONTENT_TYPES)[number];

export type PurposeRule = {
  contentTypes: readonly StorableContentType[];
  maxBytes: number;
  /** `non_production`: refused when APP_ENV is production. */
  environments: "all" | "non_production";
};

export const PURPOSE_RULES: Record<FilePurpose, PurposeRule> = {
  /** The signed-in demo page and the Seam 2 round trip. */
  test_upload: {
    contentTypes: STORABLE_CONTENT_TYPES,
    maxBytes: 10 * MiB,
    environments: "non_production",
  },
  /** Proof a directory listing uploads for FOA's verification (#127). */
  directory_document: {
    contentTypes: ["application/pdf", "image/jpeg", "image/png"],
    maxBytes: 10 * MiB,
    environments: "all",
  },
};

export type UploadRefusal =
  | "purpose_unavailable"
  | "type_not_allowed"
  | "too_large"
  | "empty";

export type StoredObjectRefusal =
  | "upload_missing"
  | "size_mismatch"
  | "type_mismatch";

export type Check<Refusal> = { ok: true } | { ok: false; refusal: Refusal };

/** How types are compared and stored: trimmed and lower-cased. */
export function normaliseContentType(contentType: string): string {
  return contentType.trim().toLowerCase();
}

function isStorable(
  rule: PurposeRule,
  contentType: string
): contentType is StorableContentType {
  return (rule.contentTypes as readonly string[]).includes(
    normaliseContentType(contentType)
  );
}

/**
 * Whether an upload of `sizeBytes` bytes of `contentType` may be presigned
 * for `purpose`. Checks the purpose, then the type, then the size.
 */
export function checkUploadRequest(
  request: { purpose: FilePurpose; contentType: string; sizeBytes: number },
  appEnv: AppEnv
): Check<UploadRefusal> {
  const rule = PURPOSE_RULES[request.purpose];
  if (rule.environments === "non_production" && appEnv === "production") {
    return { ok: false, refusal: "purpose_unavailable" };
  }
  if (!isStorable(rule, request.contentType)) {
    return { ok: false, refusal: "type_not_allowed" };
  }
  if (!Number.isInteger(request.sizeBytes) || request.sizeBytes < 1) {
    return { ok: false, refusal: "empty" };
  }
  if (request.sizeBytes > rule.maxBytes) {
    return { ok: false, refusal: "too_large" };
  }
  return { ok: true };
}

/**
 * Whether the object storage holds what was declared at presign: the same
 * size and type. `stored` is the storage's HEAD answer, null if no object.
 */
export function checkStoredObject(
  declared: { contentType: string; sizeBytes: number },
  stored: { sizeBytes: number; contentType: string | null } | null
): Check<StoredObjectRefusal> {
  if (stored === null) return { ok: false, refusal: "upload_missing" };
  if (stored.sizeBytes !== declared.sizeBytes) {
    return { ok: false, refusal: "size_mismatch" };
  }
  if (
    stored.contentType === null ||
    normaliseContentType(stored.contentType) !==
      normaliseContentType(declared.contentType)
  ) {
    return { ok: false, refusal: "type_mismatch" };
  }
  return { ok: true };
}
