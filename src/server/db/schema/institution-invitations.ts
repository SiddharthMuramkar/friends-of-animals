// Coordinator invitations (#74). The authorised person of a verified
// institution invites a teacher by email or phone; the link in the message
// carries a secret token, and the invitee accepts it signed in with that
// same email or phone. Accepting grants the `institution_coordinator` role
// scoped to the institution (`user_role`, #59), which is the membership
// itself: no separate member table.
//
// Stored statuses are pending, accepted and revoked. "Expired" is read from
// `expires_at` against the clock
// (src/server/modules/institutions/domain/invitation.ts), so no job flips
// rows.
//
// Personal data: the invitee's email or phone, encrypted (field cipher,
// purpose "institution_invitation.identifier") with a blind index beside it.
// The token is kept only as a SHA-256 hash to find the row by, plus an
// encrypted copy for the outbox handler to build the link at send time; the
// copy is cleared once the invitation stops being pending.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { encryptedText } from "../types/encrypted-text";
import { user } from "./identity";
import { institution } from "./institutions";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** What is stored; "expired" is derived from `expires_at`. */
export const institutionInvitationStatus = pgEnum(
  "institution_invitation_status",
  ["pending", "accepted", "revoked"]
);

/** How the invitation reaches the invitee. */
export const institutionInvitationChannel = pgEnum(
  "institution_invitation_channel",
  ["email", "phone"]
);

export const institutionInvitation = pgTable(
  "institution_invitation",
  {
    id: uuid().primaryKey(),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institution.id, { onDelete: "cascade" }),
    channel: institutionInvitationChannel().notNull(),
    /** The normalised email or E.164 phone, encrypted. */
    identifierCiphertext: encryptedText("identifier_ciphertext").notNull(),
    /** Its blind index: how a repeat invite and the accept check match it. */
    identifierHash: text("identifier_hash").notNull(),
    /** SHA-256 of the link token, lower-case hex: how the link finds the row. */
    tokenHash: text("token_hash").notNull().unique(),
    /** The link token, encrypted, while pending; null after. */
    tokenCiphertext: encryptedText("token_ciphertext"),
    status: institutionInvitationStatus().notNull().default("pending"),
    /** Null for seed data, or once the inviter's account is gone. */
    invitedByUserId: uuid("invited_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    acceptedAt: timestamptz("accepted_at"),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamptz("revoked_at"),
    revokedByUserId: uuid("revoked_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    // One live invitation per person per institution: inviting again
    // withdraws the earlier one first.
    uniqueIndex("institution_invitation_one_pending_per_identifier")
      .on(table.institutionId, table.identifierHash)
      .where(sql`${table.status} = 'pending'`),
    index("institution_invitation_institution_id_idx").on(table.institutionId),
    // Deleting a user sets these to null; the indexes keep that from scanning.
    index("institution_invitation_invited_by_user_id_idx").on(
      table.invitedByUserId
    ),
    index("institution_invitation_accepted_by_user_id_idx").on(
      table.acceptedByUserId
    ),
    index("institution_invitation_revoked_by_user_id_idx").on(
      table.revokedByUserId
    ),
    // The token's readable copy lives only as long as the link works.
    check(
      "institution_invitation_token_only_while_pending",
      sql`${table.status} = 'pending' OR ${table.tokenCiphertext} IS NULL`
    ),
    check(
      "institution_invitation_accepted_at_matches_status",
      sql`(${table.status} = 'accepted') = (${table.acceptedAt} IS NOT NULL)`
    ),
    check(
      "institution_invitation_revoked_at_matches_status",
      sql`(${table.status} = 'revoked') = (${table.revokedAt} IS NOT NULL)`
    ),
    check(
      "institution_invitation_expires_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
  ]
);

export type InstitutionInvitation = typeof institutionInvitation.$inferSelect;
