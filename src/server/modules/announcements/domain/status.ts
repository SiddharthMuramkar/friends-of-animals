// The life of an announcement (#84). A competition manager edits a draft;
// sending it freezes it for good. A sent announcement is never edited or
// sent again: a correction is a new announcement.
//
// Plain TypeScript with no imports, so the schema file and the seed script
// can load it under plain Node.

export const ANNOUNCEMENT_STATUSES = ["draft", "sent"] as const;

export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

const NEXT: Record<AnnouncementStatus, readonly AnnouncementStatus[]> = {
  draft: ["sent"],
  sent: [],
};

/** Whether an announcement in status `from` may move to `to`. */
export function canMoveAnnouncement(
  from: AnnouncementStatus,
  to: AnnouncementStatus
): boolean {
  return NEXT[from].includes(to);
}

/** Only a draft's content may change. */
export function isAnnouncementEditable(status: AnnouncementStatus): boolean {
  return status === "draft";
}
