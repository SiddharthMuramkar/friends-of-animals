// Volunteer applications (#123). A signed-in member applies to volunteer:
// the areas they'd like to help with, when they're free, and the two
// declarations (the safeguarding declaration and the code of conduct),
// recorded as consent events on published documents. A 14- to 17-year-old's
// application waits for a verified guardian (`awaiting_guardian`); an
// adult's goes straight to a community manager (`submitted`). The status
// follows the transition table in
// src/server/modules/volunteers/domain/application-status.ts, and a person
// has at most one open application (the partial unique index).
//
// Approval records which consent events it rested on and grants the global
// `volunteer` role (`user_role`); the role, not this row, is what lets the
// person volunteer.
//
// Personal data: the date of birth the age gate counted from is encrypted
// by the field cipher (copied from the applicant's participant profile
// when they have one, typed otherwise), and so is a decline reason, which
// can say something about the person. Every personal-data column is in
// src/server/modules/privacy/inventory.ts.
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
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  VOLUNTEER_INTERESTS,
  type Availability,
} from "../../modules/volunteers/domain/application-input";
import { VOLUNTEER_APPLICATION_STATUSES } from "../../modules/volunteers/domain/application-status";
import { encryptedText } from "../types/encrypted-text";
import { consentEvent } from "./consent";
import { user } from "./identity";
import { participantProfile } from "./registration";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** Every status from the start (ADR 0004): no value is added later. */
export const volunteerApplicationStatusEnum = pgEnum(
  "volunteer_application_status",
  VOLUNTEER_APPLICATION_STATUSES
);

/** The six areas an applicant can offer to help with. */
export const volunteerInterestEnum = pgEnum(
  "volunteer_interest",
  VOLUNTEER_INTERESTS
);

export const volunteerApplication = pgTable(
  "volunteer_application",
  {
    id: uuid().primaryKey(),
    applicantUserId: uuid("applicant_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * The participant profile the date of birth came from: a teen's
     * guardian-kept profile their login is linked to, or an adult's own.
     * Null when the applicant typed it, or once the profile is gone.
     */
    participantProfileId: uuid("participant_profile_id").references(
      () => participantProfile.id,
      { onDelete: "set null" }
    ),
    /** `YYYY-MM-DD`, encrypted for purpose "volunteer_application.dob". */
    dateOfBirthCiphertext: encryptedText("date_of_birth_ciphertext").notNull(),
    interests: volunteerInterestEnum().array().notNull(),
    /** Weekly slots and an optional note (domain/application-input.ts). */
    availability: jsonb().$type<Availability>().notNull(),
    status: volunteerApplicationStatusEnum().notNull(),
    /** The verified guardian who approved or declined a minor's application. */
    guardianUserId: uuid("guardian_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    guardianDecidedAt: timestamptz("guardian_decided_at"),
    /** The consent events a community manager's approval rested on. */
    safeguardingConsentId: uuid("safeguarding_consent_id").references(
      () => consentEvent.id
    ),
    conductConsentId: uuid("conduct_consent_id").references(
      () => consentEvent.id
    ),
    /** The community manager who approved or declined. */
    decidedByUserId: uuid("decided_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamptz("decided_at"),
    /**
     * Why a community manager declined, as the applicant is told;
     * encrypted for purpose "volunteer_application.decline_reason".
     */
    declineReasonCiphertext: encryptedText("decline_reason_ciphertext"),
    /** When it reached a closed status: approved, declined or withdrawn. */
    closedAt: timestamptz("closed_at"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // One open application per person: applying again waits until it
    // closes.
    uniqueIndex("volunteer_application_one_open_per_applicant")
      .on(table.applicantUserId)
      .where(sql`${table.status} IN ('awaiting_guardian', 'submitted')`),
    index("volunteer_application_applicant_user_id_idx").on(
      table.applicantUserId
    ),
    // The review queue lists by status, oldest first.
    index("volunteer_application_status_created_at_idx").on(
      table.status,
      table.createdAt
    ),
    // Deleting a user or profile sets these to null; the indexes keep that
    // from scanning.
    index("volunteer_application_participant_profile_id_idx").on(
      table.participantProfileId
    ),
    index("volunteer_application_guardian_user_id_idx").on(
      table.guardianUserId
    ),
    index("volunteer_application_decided_by_user_id_idx").on(
      table.decidedByUserId
    ),
    check(
      "volunteer_application_has_interests",
      sql`cardinality(${table.interests}) > 0`
    ),
    check(
      "volunteer_application_closed_at_matches_status",
      sql`(${table.status} IN ('awaiting_guardian', 'submitted')) = (${table.closedAt} IS NULL)`
    ),
    check(
      "volunteer_application_approval_recorded",
      sql`${table.status} <> 'approved' OR (${table.safeguardingConsentId} IS NOT NULL AND ${table.conductConsentId} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)`
    ),
    check(
      "volunteer_application_decline_has_reason",
      sql`${table.status} <> 'declined' OR (${table.declineReasonCiphertext} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)`
    ),
    check(
      "volunteer_application_reason_only_when_declined",
      sql`${table.status} = 'declined' OR ${table.declineReasonCiphertext} IS NULL`
    ),
  ]
);

export type VolunteerApplication = typeof volunteerApplication.$inferSelect;
