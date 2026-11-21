// Adoption applications and success stories (#130). A signed-in adult
// applies for a published animal; FOA's adoption coordinator reviews the
// application, puts the applicant in touch with the organisation that
// listed the animal and records the outcome. The adopter may then write a
// success story, published only with their consent.
//
// The statuses come from the domain's lists, so the enums and the state
// machines agree, and both enums are created in full here: no later
// migration adds a value.
//
// Waiting on other tickets (the PR lists them): adoption_listing_id gets
// its foreign key to #129's adoption_listing, the consent event ids theirs
// to #64's consent_event, and phone, address and date_of_birth become #58's
// encryptedText() columns, which are `text` in SQL too.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { ApplicationAnswers } from "../../modules/adoption/domain/application-answers";
import {
  ADOPTION_APPLICATION_STATUSES,
  MAX_REASON_LENGTH,
  OPEN_APPLICATION_STATUSES,
} from "../../modules/adoption/domain/application-status";
import {
  ADOPTION_STORY_STATUSES,
  STORY_TEXT_MAX,
  STORY_TEXT_MIN,
} from "../../modules/adoption/domain/success-story";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** `'submitted', 'under_review', 'in_contact'`: constants, never input. */
const OPEN_LIST = sql.raw(
  OPEN_APPLICATION_STATUSES.map((status) => `'${status}'`).join(", ")
);

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
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    /** #129's adoption_listing; the foreign key arrives with that table. */
    adoptionListingId: uuid("adoption_listing_id").notNull(),
    /** An applicant's applications go with their account. */
    applicantUserId: uuid("applicant_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** applicationAnswersSchema; never contact details. */
    answers: jsonb().$type<ApplicationAnswers>().notNull(),
    /** E.164, encrypted (field cipher purpose "adoption_application.phone"). */
    phone: text().notNull(),
    /** Encrypted ("adoption_application.address"). */
    address: text().notNull(),
    /**
     * `YYYY-MM-DD`, encrypted ("adoption_application.date_of_birth"), only
     * when the applicant had no profile date of birth and typed one.
     */
    dateOfBirth: text("date_of_birth"),
    /** The adoption_contact_sharing consent given with the application (#64). */
    sharingConsentEventId: uuid("sharing_consent_event_id").notNull(),
    status: adoptionApplicationStatus().notNull().default("submitted"),
    /** The coordinator who last moved it. */
    coordinatorUserId: uuid("coordinator_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /**
     * Why it ended: the coordinator's reason (staff-facing, never sent to
     * the applicant verbatim), the applicant's own on withdrawal, or
     * adopted_elsewhere / listing_withdrawn when the listing closed.
     */
    outcomeReason: text("outcome_reason"),
    submittedAt: timestamptz("submitted_at").notNull(),
    reviewStartedAt: timestamptz("review_started_at"),
    /** When the listing's representatives got the applicant's contact. */
    contactSharedAt: timestamptz("contact_shared_at"),
    /** Set when it reaches a final status; retention counts from here. */
    decidedAt: timestamptz("decided_at"),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // One open application per applicant and listing. A closed one stays,
    // and the applicant may apply again.
    uniqueIndex("adoption_application_one_open_per_applicant")
      .on(table.adoptionListingId, table.applicantUserId)
      .where(sql`${table.status} IN (${OPEN_LIST})`),
    index("adoption_application_listing_status_idx").on(
      table.adoptionListingId,
      table.status
    ),
    index("adoption_application_applicant_idx").on(
      table.applicantUserId,
      table.submittedAt.desc()
    ),
    // The coordinator's queue: open applications, oldest first.
    index("adoption_application_open_queue_idx")
      .on(table.submittedAt)
      .where(sql`${table.status} IN (${OPEN_LIST})`),
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("adoption_application_coordinator_idx").on(table.coordinatorUserId),
    check(
      "adoption_application_decided_at_when_final",
      sql`(${table.status} IN (${OPEN_LIST})) = (${table.decidedAt} IS NULL)`
    ),
    check(
      "adoption_application_reason_when_required",
      sql`${table.status} NOT IN ('not_matched', 'declined', 'listing_closed') OR ${table.outcomeReason} IS NOT NULL`
    ),
    check(
      "adoption_application_reason_length",
      sql`${table.outcomeReason} IS NULL OR char_length(${table.outcomeReason}) <= ${sql.raw(String(MAX_REASON_LENGTH))}`
    ),
    check(
      "adoption_application_contact_shared_when_in_contact",
      sql`${table.status} NOT IN ('in_contact', 'adopted') OR ${table.contactSharedAt} IS NOT NULL`
    ),
  ]
);

export type AdoptionApplicationRow = typeof adoptionApplication.$inferSelect;

export const adoptionStory = pgTable(
  "adoption_story",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    /** One story per adoption; it goes with its application. */
    applicationId: uuid("application_id")
      .notNull()
      .unique()
      .references(() => adoptionApplication.id, { onDelete: "cascade" }),
    /** Plain text (parseStoryText), escaped when shown. */
    text: text().notNull(),
    /** The adoption_success_story consent given with it (#64). */
    consentEventId: uuid("consent_event_id").notNull(),
    status: adoptionStoryStatus().notNull().default("draft"),
    submittedAt: timestamptz("submitted_at").notNull(),
    publishedAt: timestamptz("published_at"),
    withdrawnAt: timestamptz("withdrawn_at"),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // The public stories page: newest first.
    index("adoption_story_published_idx")
      .on(table.publishedAt.desc())
      .where(sql`${table.status} = 'published'`),
    check(
      "adoption_story_text_length",
      sql`char_length(${table.text}) BETWEEN ${sql.raw(String(STORY_TEXT_MIN))} AND ${sql.raw(String(STORY_TEXT_MAX))}`
    ),
    check(
      "adoption_story_published_at_when_published",
      sql`${table.status} <> 'published' OR ${table.publishedAt} IS NOT NULL`
    ),
    check(
      "adoption_story_withdrawn_at_when_withdrawn",
      sql`(${table.status} = 'withdrawn') = (${table.withdrawnAt} IS NOT NULL)`
    ),
  ]
);

export type AdoptionStoryRow = typeof adoptionStory.$inferSelect;
