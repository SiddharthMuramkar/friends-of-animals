// The contact inbox's entries in the data inventory, and its retention
// policy (#113). Every column holding what a sender wrote, how to reach
// them, the keyed hash of their network, or what staff noted while
// handling the message is listed with its purpose and how long it stays:
// 24 months after the message closes, a default FOA's counsel still has to
// confirm (HR-31).
//
// The platform's data inventory includes CONTACT_INVENTORY. The contact
// module owns the inbox's field descriptions and retention metadata.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, asc, eq, lte } from "drizzle-orm";

import inventoryMessages from "../../../../messages/en-IN/adminPrivacy.json";

import type { AppDb } from "../../db/app-db";
import { contactMessage } from "../../db/schema";
import type {
  InventoryEntry,
  PersonalDataCategory,
} from "../privacy/domain/coverage";

/** How long a message stays once it is closed (HR-31). */
export const MONTHS_AFTER_CLOSE = 24;

/** The platform's inventory entry, for the inbox's two tables. */
export type ContactInventoryEntry = InventoryEntry & {
  table: "contact_message" | "contact_note";
  retention: InventoryEntry["retention"] & { policy: "contactMessages" };
};

const RETENTION: ContactInventoryEntry["retention"] = {
  policy: "contactMessages",
  period: `While the message is open, then ${MONTHS_AFTER_CLOSE} months after it is closed`,
  basis:
    "FOA answers the sender, and can look back at what was asked and how " +
    "it was handled (legal basis to confirm)",
  toConfirm: true,
};

/** Whoever wrote the message, found again by the address they gave. */
const SENDER = { kind: "contact_sender", via: "email" } as const;
const PURPOSES = inventoryMessages.adminPrivacy.inventory.purposes;

const message = (
  column: keyof typeof PURPOSES.contact_message,
  category: PersonalDataCategory,
  subject: InventoryEntry["subject"] = SENDER
): ContactInventoryEntry => ({
  table: "contact_message",
  column,
  category,
  purpose: PURPOSES.contact_message[column],
  subject,
  retention: RETENTION,
  onExpiry: "delete_row",
});

const note = (
  column: keyof typeof PURPOSES.contact_note,
  category: PersonalDataCategory,
  subject: InventoryEntry["subject"] = {
    kind: "contact_sender",
    via: "message_id",
  }
): ContactInventoryEntry => ({
  table: "contact_note",
  column,
  category,
  purpose: PURPOSES.contact_note[column],
  subject,
  retention: RETENTION,
  onExpiry: "delete_row",
});

export const CONTACT_INVENTORY: readonly ContactInventoryEntry[] = [
  message("name", "identity"),
  message("email", "contact"),
  message("organisation", "identity"),
  message("subject", "content"),
  message("message", "content"),
  message("ip_hash", "technical"),
  message("assigned_to_user_id", "identity", {
    kind: "user",
    via: "assigned_to_user_id",
  }),
  note("body", "content"),
  note("author_user_id", "identity", { kind: "user", via: "author_user_id" }),
];

/** The policy #114's engine registers: delete closed messages, notes and all. */
export const CONTACT_RETENTION_POLICY = {
  key: "contactMessages",
  table: "contact_message",
  action: "delete",
  candidates: contactRetentionCandidates,
} as const;

/**
 * Messages closed at least MONTHS_AFTER_CLOSE months before `now`, by id.
 * Open messages are never picked, and a reopened one counts from when it
 * next closes. Deleting a message takes its notes with it (ON DELETE
 * CASCADE).
 */
export async function contactRetentionCandidates(
  db: AppDb,
  now: Date
): Promise<string[]> {
  const closedBefore = new Date(now.getTime());
  closedBefore.setUTCMonth(closedBefore.getUTCMonth() - MONTHS_AFTER_CLOSE);
  const rows = await db
    .select({ id: contactMessage.id })
    .from(contactMessage)
    .where(
      and(
        eq(contactMessage.status, "closed"),
        lte(contactMessage.closedAt, closedBefore)
      )
    )
    .orderBy(asc(contactMessage.id));
  return rows.map((row) => row.id);
}
