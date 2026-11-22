// What the notifications module (#69) needs to know about contact
// messages: who the team is (the route row's `contact_team` audience) and
// what a template may say about a message. Only its reference and topic:
// never the sender's name or words, which anyone could type to make FOA
// mail them to a stranger or show them to staff in a notification.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq } from "drizzle-orm";

import contactMessages from "../../../../messages/en-IN/contact.json";
import type { AppDb } from "../../db/app-db";
import { contactMessage, userRole } from "../../db/schema";
import type { ContactTopic } from "./domain/routing";

/** What a contact template may use, besides the recipient's own name. */
export const CONTACT_MESSAGE_VARIABLES = [
  "contact.reference",
  "contact.topic",
] as const;

/** The topic as the contact page names it, such as "Schools". */
export function contactTopicLabel(topic: ContactTopic): string {
  return contactMessages.contact.topics.items[topic].title;
}

/** The template values for message `messageId`, or null once it is gone. */
export async function contactMessageValues(
  db: AppDb,
  messageId: string
): Promise<Record<(typeof CONTACT_MESSAGE_VARIABLES)[number], string> | null> {
  const [row] = await db
    .select({
      reference: contactMessage.reference,
      topic: contactMessage.topic,
    })
    .from(contactMessage)
    .where(eq(contactMessage.id, messageId));
  if (!row) return null;
  return {
    "contact.reference": row.reference,
    "contact.topic": contactTopicLabel(row.topic),
  };
}

/**
 * The team a message was routed to when it arrived: everyone holding that
 * role globally. Staff admins see every message in the inbox, but only the
 * team is told about each one.
 */
export async function contactTeamMembers(
  db: AppDb,
  messageId: string
): Promise<string[]> {
  const [message] = await db
    .select({ team: contactMessage.team })
    .from(contactMessage)
    .where(eq(contactMessage.id, messageId));
  if (!message) return [];
  const rows = await db
    .selectDistinct({ userId: userRole.userId })
    .from(userRole)
    .where(
      and(eq(userRole.role, message.team), eq(userRole.scopeType, "global"))
    );
  return rows.map((row) => row.userId).sort();
}
