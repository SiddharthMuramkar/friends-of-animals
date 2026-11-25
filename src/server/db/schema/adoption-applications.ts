// Adoption applications and success stories (#130). A signed-in adult
// applies for a published animal (#129); FOA's adoption coordinator
// reviews the application, puts the applicant in touch with the listing
// organisation and records the outcome. The status follows the transition
// table in src/server/modules/adoption/domain/application-status.ts, and a
// person has at most one open application per animal (the partial unique
// index). After an adoption the adopter may write a success story, which
// FOA shares on /adopt/stories only while they consent.
//
// Personal data: the applicant's phone, postal address, answers about their
// home, the date of birth the age rule counted from, and the
// coordinator's reason for an ending are encrypted by the field cipher.
// The listing organisation reads phone, address and answers only from
// `in_contact` on. Every personal-data column is in
// src/server/modules/privacy/inventory.ts.
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

import { ADOPTION_APPLICATION_STATUSES } from "../../modules/adoption/domain/application-status";
import { ADOPTION_STORY_STATUSES } from "../../modules/adoption/domain/success-story";
import { encryptedText } from "../types/encrypted-text";
import { adoptionListing } from "./adoption";
import { consentEvent } from "./consent";
import { user } from "./identity";
import { participantProfile } from "./registration";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** Every status from the start (ADR 0004): no value is added later. */
export const adoptionApplicationStatus = pgEnum(
  "adoption_application_status",
  ADOPTION_APPLICATION_STATUSES
);

export const adoptionStoryStatus = pgEnum(
  "adoption_story_status",
  ADOPTION_STORY_STATUSES
);

export const adoptionApplication = pgTable(
  "adoption_application",
  {
    /** UUIDv7. */
    id: uuid().primaryKey(),
    adoptionListingId: uuid("adoption_listing_id")
      .notNull()
      .references(() => adoptionListing.id, { onDelete: "restrict" }),
    applicantUserId: uuid("applicant_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * The participant profile the date of birth came from (an adult's own,
     * or the guardian-kept profile a teen's login is linked to); null when
     * the applicant typed it, or once the profile is gone.
     */
    participantProfileId: uuid("participant_profile_id").references(
      () => participantProfile.id,
      { onDelete: "set null" }
    ),
    /** `YYYY-MM-DD`, for purpose "adoption_application.dob". */
    dateOfBirthCiphertext: encryptedText("date_of_birth_ciphertext").notNull(),
    /** E.164, for purpose "adoption_application.phone". */
    phoneCiphertext: encryptedText("phone_ciphertext").notNull(),
    /** For purpose "adoption_application.address". */
    addressCiphertext: encryptedText("address_ciphertext").notNull(),
    /** The answers as JSON, for purpose "adoption_application.answers". */
    answersCiphertext: encryptedText("answers_ciphertext").notNull(),
    /** The consent to share contact details the application rests on. */
    contactSharingConsentId: uuid("contact_sharing_consent_id")
      .notNull()
      .references(() => consentEvent.id),
    status: adoptionApplicationStatus().notNull(),
    /** When the coordinator shared the contact with the organisation. */
    contactSharedAt: timestamptz("contact_shared_at"),
    /** The coordinator who made the last move; null once they are gone. */
    decidedByUserId: uuid("decided_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /**
     * Why it ended not matched or declined, for staff; purpose
     * "adoption_application.outcome_reason". The applicant's message never
     * quotes it.
     */
    outcomeReasonCiphertext: encryptedText("outcome_reason_ciphertext"),
    /** When it reached a closed status. */
    closedAt: timestamptz("closed_at"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // One open application per person per animal.
    uniqueIndex("adoption_application_one_open_per_listing")
      .on(table.adoptionListingId, table.applicantUserId)
      .where(
        sql`${table.status} IN ('submitted', 'under_review', 'in_contact')`
      ),
    index("adoption_application_applicant_idx").on(
      table.applicantUserId,
      table.createdAt
    ),
    // The coordinator's queue lists by status, oldest first.
    index("adoption_application_status_created_idx").on(
      table.status,
      table.createdAt
    ),
    index("adoption_application_participant_profile_idx").on(
      table.participantProfileId
    ),
    index("adoption_application_decided_by_idx").on(table.decidedByUserId),
    index("adoption_application_consent_idx").on(table.contactSharingConsentId),
    check(
      "adoption_application_closed_at_matches_status",
      sql`(${table.status} IN ('submitted', 'under_review', 'in_contact')) = (${table.closedAt} IS NULL)`
    ),
    check(
      "adoption_application_reason_when_ended",
      sql`(${table.status} IN ('not_matched', 'declined')) = (${table.outcomeReasonCiphertext} IS NOT NULL)`
    ),
    check(
      "adoption_application_contact_shared",
      sql`${table.status} NOT IN ('in_contact', 'adopted') OR ${table.contactSharedAt} IS NOT NULL`
    ),
  ]
);

export type AdoptionApplicationRow = typeof adoptionApplication.$inferSelect;

/** An adopter's success story: one per adopted application. */
export const adoptionStory = pgTable(
  "adoption_story",
  {
    id: uuid().primaryKey(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => adoptionApplication.id, { onDelete: "cascade" }),
    /** Plain text, 20 to 2000 characters, shown escaped. */
    body: text().notNull(),
    status: adoptionStoryStatus().notNull(),
    /** The consent to share the story it was written and published on. */
    consentEventId: uuid("consent_event_id")
      .notNull()
      .references(() => consentEvent.id),
    publishedAt: timestamptz("published_at"),
    /** The coordinator who published it; null once they are gone. */
    publishedByUserId: uuid("published_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    withdrawnAt: timestamptz("withdrawn_at"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("adoption_story_application_unique").on(table.applicationId),
    // /adopt/stories: published, newest first.
    index("adoption_story_status_published_idx").on(
      table.status,
      table.publishedAt.desc()
    ),
    index("adoption_story_consent_idx").on(table.consentEventId),
    index("adoption_story_published_by_idx").on(table.publishedByUserId),
    check(
      "adoption_story_published_at_matches_status",
      sql`${table.status} <> 'published' OR ${table.publishedAt} IS NOT NULL`
    ),
    check(
      "adoption_story_withdrawn_at_matches_status",
      sql`(${table.status} = 'withdrawn') = (${table.withdrawnAt} IS NOT NULL)`
    ),
  ]
);

export type AdoptionStoryRow = typeof adoptionStory.$inferSelect;
