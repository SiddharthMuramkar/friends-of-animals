// Guardians (#81). A signed-in user declares they are an adult and a child's
// parent or lawful guardian, then verifies by a one-time code sent to their
// own verified email: that moment is `verified_at`, and only then may they
// add children. Each child is a participant profile the guardian owns
// (`participant_profile.owner_kind` guardian, src/server/db/schema/
// registration.ts), tied to its guardian by a `guardian_link` that says
// how they are related. Under 13 the profile has no login; from 13 to 17
// the guardian invites the teen to an own login (`guardian_invitation`,
// kind teen_login), which the teen accepts signed in with the invited
// address, setting the profile's `login_user_id`.
//
// Stored invitation statuses are pending, accepted and revoked; "expired"
// is read from `expires_at` against the clock, as for coordinator
// invitations (#74). The token is kept as a SHA-256 hash to find the row
// by, plus an encrypted copy for the outbox handler to build the link at
// send time, cleared once the invitation stops being pending.
//
// Personal data: the guardian's full name and phone, and an invitation's
// address, encrypted with the field cipher (blind indexes beside the phone
// and the address). The data inventory lists every column
// (src/server/modules/privacy/inventory.ts).
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

import {
  GUARDIAN_INVITATION_CHANNELS,
  GUARDIAN_INVITATION_KINDS,
  GUARDIAN_INVITATION_STATUSES,
  GUARDIAN_VERIFICATION_METHODS,
} from "../../modules/guardians/domain/vocabulary";
import { encryptedText } from "../types/encrypted-text";
import { user } from "./identity";
import { guardianRelationshipEnum, participantProfile } from "./registration";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** How a guardian proved the contact the code went to is theirs. */
export const guardianVerificationMethodEnum = pgEnum(
  "guardian_verification_method",
  GUARDIAN_VERIFICATION_METHODS
);

/**
 * A guardian inviting a teen to an own login (#81), or a teen asking a
 * guardian to look after their profile (81b): both declared now, so 81b
 * adds no value and uses it in one run (rule F2).
 */
export const guardianInvitationKindEnum = pgEnum(
  "guardian_invitation_kind",
  GUARDIAN_INVITATION_KINDS
);

/** What is stored; "expired" is derived from `expires_at`. */
export const guardianInvitationStatusEnum = pgEnum(
  "guardian_invitation_status",
  GUARDIAN_INVITATION_STATUSES
);

/** How the invitation reaches the invitee: email now, phone later. */
export const guardianInvitationChannelEnum = pgEnum(
  "guardian_invitation_channel",
  GUARDIAN_INVITATION_CHANNELS
);

/** One user's declaration as a guardian, and when they verified it. */
export const guardian = pgTable(
  "guardian",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Encrypted for purpose "guardian.full_name". */
    fullNameCiphertext: encryptedText("full_name_ciphertext").notNull(),
    /** E.164, encrypted for purpose "guardian.phone"; optional. */
    phoneCiphertext: encryptedText("phone_ciphertext"),
    /** The phone's blind index, beside its ciphertext. */
    phoneHash: text("phone_hash"),
    /**
     * When they last declared "I am 18 or older and the parent or lawful
     * guardian": the declaration the verification confirms.
     */
    adultDeclaredAt: timestamptz("adult_declared_at").notNull(),
    /** When they entered the code; null until then. */
    verifiedAt: timestamptz("verified_at"),
    verificationMethod: guardianVerificationMethodEnum("verification_method"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check(
      "guardian_verified_with_method",
      sql`(${table.verifiedAt} IS NULL) = (${table.verificationMethod} IS NULL)`
    ),
    check(
      "guardian_phone_complete",
      sql`(${table.phoneCiphertext} IS NULL) = (${table.phoneHash} IS NULL)`
    ),
  ]
);

export type Guardian = typeof guardian.$inferSelect;

/**
 * Who looks after a child, and how they are related. One live link per
 * guardian and child; a revoked one stays as history. The schema allows a
 * second guardian per child; no page offers it yet.
 */
export const guardianLink = pgTable(
  "guardian_link",
  {
    id: uuid().primaryKey(),
    guardianId: uuid("guardian_id")
      .notNull()
      .references(() => guardian.id, { onDelete: "cascade" }),
    participantProfileId: uuid("participant_profile_id")
      .notNull()
      .references(() => participantProfile.id, { onDelete: "cascade" }),
    relationship: guardianRelationshipEnum().notNull(),
    createdAt: timestamptz("created_at").notNull(),
    revokedAt: timestamptz("revoked_at"),
  },
  (table) => [
    uniqueIndex("guardian_link_active_pair_unique")
      .on(table.guardianId, table.participantProfileId)
      .where(sql`${table.revokedAt} IS NULL`),
    // A teen's guardians, and a child's page, look links up by the child.
    index("guardian_link_participant_profile_id_idx").on(
      table.participantProfileId
    ),
  ]
);

export type GuardianLink = typeof guardianLink.$inferSelect;

export const guardianInvitation = pgTable(
  "guardian_invitation",
  {
    id: uuid().primaryKey(),
    kind: guardianInvitationKindEnum().notNull(),
    guardianId: uuid("guardian_id")
      .notNull()
      .references(() => guardian.id, { onDelete: "cascade" }),
    participantProfileId: uuid("participant_profile_id")
      .notNull()
      .references(() => participantProfile.id, { onDelete: "cascade" }),
    status: guardianInvitationStatusEnum().notNull().default("pending"),
    channel: guardianInvitationChannelEnum().notNull(),
    /** The normalised email, encrypted. */
    contactCiphertext: encryptedText("contact_ciphertext").notNull(),
    /** Its blind index: how the accept check matches the signed-in user. */
    contactHash: text("contact_hash").notNull(),
    /** SHA-256 of the link token, lower-case hex: how the link finds the row. */
    tokenHash: text("token_hash").notNull().unique(),
    /** The link token, encrypted, while pending; null after. */
    tokenCiphertext: encryptedText("token_ciphertext"),
    expiresAt: timestamptz("expires_at").notNull(),
    acceptedAt: timestamptz("accepted_at"),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamptz("revoked_at"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // One live invitation of each kind per child: inviting again withdraws
    // the earlier one first.
    uniqueIndex("guardian_invitation_one_pending_per_child")
      .on(table.participantProfileId, table.kind)
      .where(sql`${table.status} = 'pending'`),
    index("guardian_invitation_guardian_id_idx").on(table.guardianId),
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("guardian_invitation_accepted_by_user_id_idx").on(
      table.acceptedByUserId
    ),
    check(
      "guardian_invitation_token_only_while_pending",
      sql`${table.status} = 'pending' OR ${table.tokenCiphertext} IS NULL`
    ),
    check(
      "guardian_invitation_accepted_at_matches_status",
      sql`(${table.status} = 'accepted') = (${table.acceptedAt} IS NOT NULL)`
    ),
    check(
      "guardian_invitation_revoked_at_matches_status",
      sql`(${table.status} = 'revoked') = (${table.revokedAt} IS NOT NULL)`
    ),
    check(
      "guardian_invitation_expires_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
  ]
);

export type GuardianInvitation = typeof guardianInvitation.$inferSelect;
