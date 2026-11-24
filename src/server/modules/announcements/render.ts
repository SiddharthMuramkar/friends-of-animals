// What an announcement says, as the values its message template fills in
// (drizzle/*_84_announcement_messages.sql): the competition's name, the
// subject, and the body, which is each filled section under its heading,
// in reading order. The headings come from messages/en-IN, like every
// other copy (FOA reviews them); the event's date and time are written in
// IST. Everything is plain text: #69's renderer escapes it for the email's
// HTML part, so nothing a manager types becomes markup.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq } from "drizzle-orm";
import { createFormatter, createTranslator } from "next-intl";

import adminAnnouncements from "../../../../messages/en-IN/adminAnnouncements.json";
import { formats, LOCALE, TIME_ZONE } from "../../../i18n/formats";
import { announcement, competition } from "../../db/schema";
import type { OutboxDeps } from "../../outbox/handlers";
import {
  announcementSections,
  type AnnouncementContent,
} from "./domain/content";
import { contentOf } from "./use-cases/drafts";

/** The variables an announcement's template may use, beyond the recipient's. */
export const ANNOUNCEMENT_VARIABLES = [
  "competition.name",
  "announcement.subject",
  "announcement.body",
] as const;

// A missing heading fails the delivery loudly rather than mailing the key.
function refuseFallback(error: Error): never {
  throw error;
}
const headings = createTranslator({
  locale: LOCALE,
  messages: adminAnnouncements,
  namespace: "adminAnnouncements.letter.sections",
  onError: refuseFallback,
});
const format = createFormatter({
  locale: LOCALE,
  formats,
  timeZone: TIME_ZONE,
});

/**
 * The filled sections, each as its heading and text, separated by blank
 * lines. The closing message has no heading.
 */
export function announcementBody(content: AnnouncementContent): string {
  return announcementSections(content)
    .map((section) => {
      if (section.key === "message") return section.value;
      const text =
        section.key === "eventAt"
          ? format.dateTime(section.value, "longDateTime")
          : section.value;
      return `${headings(section.key)}\n${text}`;
    })
    .join("\n\n");
}

/** The values the template fills in for one announcement. */
export function announcementValues(
  competitionName: string,
  content: AnnouncementContent
): Record<(typeof ANNOUNCEMENT_VARIABLES)[number], string> {
  return {
    "competition.name": competitionName,
    "announcement.subject": content.subject,
    "announcement.body": announcementBody(content),
  };
}

/** The message for a sent announcement named by its outbox payload. */
export async function announcementMessageFor(
  { db, cipher }: Pick<OutboxDeps, "db" | "cipher">,
  {
    announcementId,
    competitionId,
  }: { announcementId: string; competitionId: string }
) {
  const [row] = await db
    .select({ announcement, competitionName: competition.name })
    .from(announcement)
    .innerJoin(competition, eq(competition.id, announcement.competitionId))
    .where(
      and(
        eq(announcement.id, announcementId),
        eq(announcement.competitionId, competitionId),
        eq(announcement.status, "sent")
      )
    );
  if (!row) return null;
  return {
    sentAt: row.announcement.sentAt,
    values: announcementValues(
      row.competitionName,
      contentOf(cipher, row.announcement)
    ),
  };
}
