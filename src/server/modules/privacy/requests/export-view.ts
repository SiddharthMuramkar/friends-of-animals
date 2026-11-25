// Where an access request's data export stands, as its requester sees it
// (#115b). The export is a ZIP in the private bucket; its link works until
// `export_expires_at` (privacy.exportLinkHours after it was ready), and
// the object is deleted then. Only whoever filed the request is shown it:
// a guardian reading their teen's own request sees no link.
//
// Pure, and loads under plain Node.

import type { PrivacyRequestRow } from "../../../db/schema";

export type ExportView =
  | { state: "none" }
  | { state: "preparing" }
  | { state: "ready"; expiresAt: Date }
  | { state: "expired" };

export type ExportLinkRefusal =
  | "export_not_ready"
  | "link_expired"
  | "export_deleted";

/** May a download URL for the export be issued at `now`? */
export function decideExportLink(
  row: Pick<
    PrivacyRequestRow,
    "exportStorageKey" | "exportExpiresAt" | "exportDeletedAt"
  >,
  now: Date
): { ok: true; storageKey: string } | { ok: false; reason: ExportLinkRefusal } {
  if (row.exportDeletedAt !== null) {
    return { ok: false, reason: "export_deleted" };
  }
  if (row.exportStorageKey === null || row.exportExpiresAt === null) {
    return { ok: false, reason: "export_not_ready" };
  }
  if (now.getTime() >= row.exportExpiresAt.getTime()) {
    return { ok: false, reason: "link_expired" };
  }
  return { ok: true, storageKey: row.exportStorageKey };
}

export function exportViewOf(
  row: Pick<
    PrivacyRequestRow,
    | "type"
    | "exportRequestedAt"
    | "exportStorageKey"
    | "exportExpiresAt"
    | "exportDeletedAt"
  >,
  now: Date,
  filedByYou: boolean
): ExportView {
  if (row.type !== "access" || !filedByYou || row.exportRequestedAt === null) {
    return { state: "none" };
  }
  const link = decideExportLink(row, now);
  if (link.ok) return { state: "ready", expiresAt: row.exportExpiresAt! };
  return link.reason === "export_not_ready"
    ? { state: "preparing" }
    : { state: "expired" };
}
