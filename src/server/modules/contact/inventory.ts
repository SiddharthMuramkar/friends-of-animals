// The contact inbox's entries in the data inventory, and its retention
// policy (#113). Every column holding what a sender wrote, how to reach
// them, the keyed hash of their network, or what staff noted while
// handling the message is listed with its purpose and how long it stays:
// 24 months after the message closes, a default FOA's counsel still has to
// confirm (HR-31).
//
// The platform's inventory and retention engine (#73 creates the inventory
// file, #114 the policy registry and the daily sweep) haven't landed on
// this branch yet: they spread CONTACT_INVENTORY into the inventory and
// register CONTACT_RETENTION_POLICY when they do.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, asc, eq, lte } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { contactMessage } from "../../db/schema";

/** How long a message stays once it is closed (HR-31). */
export const MONTHS_AFTER_CLOSE = 24;

/** #73's inventory entry, with the retention policy #114 adds. */
export type ContactInventoryEntry = {
  table: "contact_message" | "contact_note";
  column: string;
  purpose: string;
  retention: {
    period: string;
    basis: string;
    toConfirm: true;
    policy: "contactMessages";
  };
};

const RETENTION: ContactInventoryEntry["retention"] = {
  period: `While the message is open, then ${MONTHS_AFTER_CLOSE} months after it is closed`,
  basis:
    "FOA answers the sender, and can look back at what was asked and how " +
    "it was handled (legal basis to confirm)",
  toConfirm: true,
  policy: "contactMessages",
};

const message = (column: string, purpose: string): ContactInventoryEntry => ({
  table: "contact_message",
  column,
  purpose,
  retention: RETENTION,
});

const note = (column: string, purpose: string): ContactInventoryEntry => ({
  table: "contact_note",
  column,
  purpose,
  retention: RETENTION,
});

export const CONTACT_INVENTORY: readonly ContactInventoryEntry[] = [
  message("name", "Lets staff address the sender when they reply"),
  message("email", "Where staff reply, and where the acknowledgement goes"),
  message(
    "organisation",
    "Tells staff which school or organisation wrote, when the sender gave one"
  ),
  message("subject", "Tells staff at a glance what the message is about"),
  message("message", "What the sender asked or told FOA, so staff can answer"),
  message(
    "ip_hash",
    "A keyed hash of the sender's network, never the address, to spot " +
      "repeated abuse of the form"
  ),
  message(
    "assigned_to_user_id",
    "Records which member of staff is handling the message"
  ),
  note("body", "What staff noted while handling the message"),
  note("author_user_id", "Records which member of staff wrote the note"),
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
