import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { encryptedText } from "../types/encrypted-text";
import type { Answer } from "../../modules/consent-links/domain/answers";
import type { OfferedPublicUse } from "../../modules/consent-links/offered-uses";
import type { PublicationPurpose } from "../../modules/consent/domain/guardian-purposes";
import { competition } from "./competitions";
import { user } from "./identity";
import {
  institutionRegistration,
  participantProfile,
  registration,
} from "./registration";

export const consentLinkChannel = pgEnum("consent_link_channel", [
  "email",
  "sms",
]);
export const consentLinkStatus = pgEnum("consent_link_status", [
  "pending",
  "used",
  "revoked",
]);

const time = (name: string) => timestamp(name, { withTimezone: true });

export const consentLink = pgTable(
  "consent_link",
  {
    id: uuid().primaryKey(),
    participantProfileId: uuid("participant_profile_id")
      .notNull()
      .references(() => participantProfile.id),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    institutionRegistrationId: uuid("institution_registration_id")
      .notNull()
      .references(() => institutionRegistration.id),
    /** Binds the link to this enrolment, even if the profile is enrolled again. */
    studentRegistrationId: uuid("student_registration_id")
      .notNull()
      .references(() => registration.id),
    channel: consentLinkChannel().notNull(),
    contactCiphertext: encryptedText("contact_ciphertext").notNull(),
    contactHash: text("contact_hash").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenCiphertext: encryptedText("token_ciphertext"),
    status: consentLinkStatus().notNull().default("pending"),
    /** Set at issuance and backed by immutable consent document versions. */
    offeredUses: jsonb("offered_uses").$type<OfferedPublicUse[]>().notNull(),
    sentByUserId: uuid("sent_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    sentAt: time("sent_at").notNull(),
    expiresAt: time("expires_at").notNull(),
    codesSent: integer("codes_sent").notNull().default(0),
    lastCodeSentAt: time("last_code_sent_at"),
    codeHash: text("code_hash"),
    codeExpiresAt: time("code_expires_at"),
    codeAttempts: integer("code_attempts").notNull().default(0),
    verifiedAt: time("verified_at"),
    sessionTokenHash: text("session_token_hash"),
    usedAt: time("used_at"),
    revokedAt: time("revoked_at"),
    answers: jsonb().$type<Partial<Record<PublicationPurpose, Answer>>>(),
    updatedAt: time("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("consent_link_pending_student_competition")
      .on(table.participantProfileId, table.competitionId)
      .where(sql`${table.status} = 'pending'`),
    index("consent_link_school_registration_idx").on(
      table.institutionRegistrationId
    ),
    index("consent_link_competition_idx").on(table.competitionId),
    index("consent_link_profile_idx").on(table.participantProfileId),
    index("consent_link_student_registration_idx").on(
      table.studentRegistrationId
    ),
    index("consent_link_sender_idx").on(table.sentByUserId),
    check(
      "consent_link_closed_state",
      sql`(${table.status} = 'used') = (${table.usedAt} IS NOT NULL)
          AND (${table.status} = 'used') = (${table.answers} IS NOT NULL)
          AND (${table.status} = 'revoked') = (${table.revokedAt} IS NOT NULL)`
    ),
  ]
);

export type ConsentLink = typeof consentLink.$inferSelect;
