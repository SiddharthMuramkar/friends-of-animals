// How long a subject's data export can be downloaded (#115). The ZIP
// sits in the private bucket; the requester gets it through a signed link
// that works for `privacy.exportLinkHours` (72 by default) after the export
// is ready, and the file itself is deleted after
// `privacy.exportRetentionDays` (7). Each download still goes through the
// Files module's short-lived presigned URL; this only decides whether one
// may be issued.
//
// Pure, and loads under plain Node.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** When the link stops working and when the file is deleted. */
export function exportLifetimes(
  readyAt: Date,
  settings: { linkHours: number; retentionDays: number }
): { linkExpiresAt: Date; deleteAt: Date } {
  const linkExpiresAt = new Date(
    readyAt.getTime() + settings.linkHours * HOUR_MS
  );
  const deleteAt = new Date(
    readyAt.getTime() + settings.retentionDays * DAY_MS
  );
  if (linkExpiresAt > deleteAt) {
    throw new RangeError(
      "An export's link can't outlive the file: raise the retention days or lower the link hours"
    );
  }
  return { linkExpiresAt, deleteAt };
}

/** Where the request's export stands. */
export type ExportState =
  | { state: "none" }
  | { state: "ready"; fileId: string; linkExpiresAt: Date }
  | { state: "deleted" };

export type ExportLinkDecision =
  | { ok: true; fileId: string }
  | {
      ok: false;
      reason: "export_not_ready" | "link_expired" | "export_deleted";
    };

/** May a download URL for the export be issued at `now`? */
export function decideExportLink(input: {
  now: Date;
  export: ExportState;
}): ExportLinkDecision {
  const current = input.export;
  if (current.state === "none")
    return { ok: false, reason: "export_not_ready" };
  if (current.state === "deleted")
    return { ok: false, reason: "export_deleted" };
  if (input.now >= current.linkExpiresAt) {
    return { ok: false, reason: "link_expired" };
  }
  return { ok: true, fileId: current.fileId };
}
