// Pure helpers for the upload island (../_components/upload-form.tsx):
// what it sends with the PUT, how often it asks about the scan, and how it
// shows a file's status. No React, so they're tested on their own.

import type { FileStatus } from "@/server/modules/files/domain/file-status";
import type { StorableContentType } from "@/server/modules/files/domain/purposes";

import type { UploadError } from "./actions";

/** How often the page asks whether the scan is done. */
export const POLL_INTERVAL_MS = 2_000;
/** How long it keeps asking before telling the user to come back later. */
export const POLL_LIMIT_MS = 60_000;

/** Headers a browser sets itself; fetch refuses or ignores them. */
const BROWSER_SET = new Set(["content-length", "host"]);

/**
 * The headers for the browser's PUT: exactly those the upload URL was
 * signed with (a different Content-Type fails the signature), minus the
 * ones the browser sets from the body itself.
 */
export function putHeaders(
  signed: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(signed).filter(
      ([name]) => !BROWSER_SET.has(name.toLowerCase())
    )
  );
}

/**
 * How long to wait before asking about the scan again, `elapsedMs` after
 * the first ask; null once the minute is up.
 */
export function nextPollDelay(elapsedMs: number): number | null {
  const left = POLL_LIMIT_MS - elapsedMs;
  return left > 0 ? Math.min(POLL_INTERVAL_MS, left) : null;
}

/** What the page says about a file. */
export type UploadPhase = "uploading" | "checking" | "ready" | "unavailable";

export function phaseForStatus(status: FileStatus): UploadPhase {
  switch (status) {
    case "pending_upload":
      return "uploading";
    case "uploaded":
    case "scanning":
      return "checking";
    case "clean":
      return "ready";
    case "quarantined":
    case "rejected":
    case "deleted":
      return "unavailable";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The file's delivery route: it checks who is asking and redirects to a
 * short-lived signed URL (GET /api/files/[id]).
 */
export function downloadPathFor(fileId: string): string {
  if (!UUID.test(fileId)) {
    throw new Error(`Not a file id: ${JSON.stringify(fileId)}`);
  }
  return `/api/files/${fileId}`;
}

const TYPE_NAME_KEY = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const satisfies Record<StorableContentType, string>;

export type TypeNameKey = (typeof TYPE_NAME_KEY)[StorableContentType];

/** The `files.types` message keys naming `types`, in the same order. */
export function typeNameKeys(
  types: readonly StorableContentType[]
): TypeNameKey[] {
  return types.map((type) => TYPE_NAME_KEY[type]);
}

/** The `files.errors` keys the island shows. */
export type MessageKey =
  | "noFile"
  | "signedOut"
  | "tooLarge"
  | "empty"
  | "typeNotAllowed"
  | "switchedOff"
  | "uploadFailed"
  | "uploadRejected"
  | "blocked"
  | "unknown";

const MESSAGE_KEY = {
  signed_out: "signedOut",
  too_large: "tooLarge",
  empty: "empty",
  type_not_allowed: "typeNotAllowed",
  purpose_unavailable: "switchedOff",
  // Storage has nothing: the PUT never arrived.
  upload_missing: "uploadFailed",
  upload_rejected: "uploadRejected",
  unknown: "unknown",
} as const satisfies Record<UploadError, MessageKey>;

/** How the page words a failed upload step. */
export function messageKeyFor(error: UploadError): MessageKey {
  return MESSAGE_KEY[error];
}
