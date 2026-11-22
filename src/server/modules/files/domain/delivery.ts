// Who may open a file, and how it is served. The policy (`can()`) says who
// may read a file at all; this adds what the file's status allows: only the
// uploader sees a file before its scan passes, and nobody ever gets a
// quarantined, rejected or deleted one.

import type { FileStatus } from "./file-status";
import type { FilePurpose } from "./purposes";

export type DeliveryRefusal =
  | "forbidden"
  | "file_not_ready"
  | "file_unavailable";

export type DeliveryDecision =
  | { allow: true }
  | { allow: false; reason: DeliveryRefusal };

const NEVER_DELIVERED: ReadonlySet<FileStatus> = new Set([
  "quarantined",
  "rejected",
  "deleted",
]);

const AWAITING_SCAN: ReadonlySet<FileStatus> = new Set([
  "uploaded",
  "scanning",
]);

/**
 * Whether a signed URL may be issued. `authorized` is the policy's answer for
 * this actor and file; it is checked first, so a caller it refuses learns
 * nothing about the file's status.
 */
export function deliveryDecision({
  status,
  isOwner,
  authorized,
}: {
  status: FileStatus;
  isOwner: boolean;
  authorized: boolean;
}): DeliveryDecision {
  if (!authorized) return { allow: false, reason: "forbidden" };
  if (NEVER_DELIVERED.has(status)) {
    return { allow: false, reason: "file_unavailable" };
  }
  if (status === "clean") return { allow: true };
  if (AWAITING_SCAN.has(status) && isOwner) return { allow: true };
  return { allow: false, reason: "file_not_ready" };
}

const INLINE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);

/** Images and PDFs open in the browser; anything else downloads. */
export function dispositionFor(contentType: string): "inline" | "attachment" {
  return INLINE_TYPES.has(contentType) ? "inline" : "attachment";
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * The name a download is saved under: `<purpose>-<first 8 of the id>.<ext>`.
 * What the uploader called the file is never stored, so it can't leak here.
 */
export function downloadFilenameFor({
  purpose,
  fileId,
  contentType,
}: {
  purpose: FilePurpose;
  fileId: string;
  contentType: string;
}): string {
  return `${purpose}-${fileId.slice(0, 8)}.${EXTENSIONS[contentType] ?? "bin"}`;
}
