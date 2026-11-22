// Registration (#75). An institution registers for a competition once; the
// registration gets a reference made of the competition's code, "I" and
// five random Crockford base32 symbols (PAWS27-I-Q2W9R), which its
// coordinators and FOA quote. Its coordinators then enrol students: each
// student is a participant profile the institution manages, with one
// registration per competition in the age group their date of birth puts
// them in. Fees (#77) and the individual route (#78) add theirs here.
//
// Personal data: `registered_by`, and a student's details on
// `participant_profile`. The date of birth, phones, emails, the guardian's
// name and the address are encrypted with the field cipher; the data
// inventory lists every column (src/server/modules/privacy/inventory.ts).
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
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { INSTITUTION_REGISTRATION_STATUSES } from "../../modules/registration/domain/institution-registration";
import {
  PARTICIPANT_OWNER_KINDS,
  REGISTRATION_ROUTES,
} from "../../modules/registration/domain/participant";
import { REGISTRATION_STATUSES } from "../../modules/registration/domain/registration-status";
import { GUARDIAN_RELATIONSHIPS } from "../../modules/registration/domain/student-details";
import { encryptedText } from "../types/encrypted-text";
import { competition, competitionAgeGroup } from "./competitions";
import { user } from "./identity";
import { institution } from "./institutions";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Active only, for now. Withdrawing (#77) and cancelling (#80) append
 * their values in migrations of their own (rule F2).
 */
export const institutionRegistrationStatusEnum = pgEnum(
  "institution_registration_status",
  INSTITUTION_REGISTRATION_STATUSES
);

/** The constraint a second registration of the same pair runs into. */
export const INSTITUTION_REGISTRATION_PAIR_UNIQUE =
  "institution_registration_institution_competition_unique";

/** The constraint `withUniqueCode` retries on when a reference is taken. */
export const INSTITUTION_REGISTRATION_REFERENCE_UNIQUE =
  "institution_registration_reference_unique";

export const institutionRegistration = pgTable(
  "institution_registration",
  {
    id: uuid().primaryKey(),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institution.id),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    /** `{competition code}-I-{5 Crockford base32}`, e.g. PAWS27-I-Q2W9R. */
    reference: text().notNull(),
    status: institutionRegistrationStatusEnum().notNull().default("active"),
    /**
     * The coordinator or authorised person who registered; null for seed
     * data, or once their account is gone.
     */
    registeredBy: uuid("registered_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // One registration per institution and competition.
    unique(INSTITUTION_REGISTRATION_PAIR_UNIQUE).on(
      table.institutionId,
      table.competitionId
    ),
    unique(INSTITUTION_REGISTRATION_REFERENCE_UNIQUE).on(table.reference),
    check(
      "institution_registration_reference_format",
      sql`${table.reference} ~ '^[A-Z]{3,6}[0-9]{2}-I-[0-9A-HJKMNP-TV-Z]{5}$'`
    ),
    // FOA lists a competition's registrations (#77, #87).
    index("institution_registration_competition_id_idx").on(
      table.competitionId
    ),
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("institution_registration_registered_by_idx").on(table.registeredBy),
  ]
);

export type InstitutionRegistration =
  typeof institutionRegistration.$inferSelect;

export const participantOwnerKindEnum = pgEnum(
  "participant_owner_kind",
  PARTICIPANT_OWNER_KINDS
);

export const guardianRelationshipEnum = pgEnum(
  "guardian_relationship",
  GUARDIAN_RELATIONSHIPS
);

/**
 * One person taking part, as whoever keeps their details knows them. A
 * school's student is one profile per institution, found again by
 * `identity_hash` when they are enrolled in another competition: the
 * latest details the school gives replace the old ones.
 */
export const participantProfile = pgTable(
  "participant_profile",
  {
    id: uuid().primaryKey(),
    ownerKind: participantOwnerKindEnum("owner_kind").notNull(),
    /** The school that keeps a student's details; only for its students. */
    managingInstitutionId: uuid("managing_institution_id").references(
      () => institution.id
    ),
    /** Plain: the dashboard sorts and shows it. */
    fullName: text("full_name").notNull(),
    /** `YYYY-MM-DD`, encrypted for purpose "participant_profile.dob". */
    dobCiphertext: encryptedText("dob_ciphertext").notNull(),
    /** Class or year, as the school writes it. */
    grade: text(),
    /** The school's own roll number for the student. */
    studentRef: text("student_ref"),
    /** An adult student's own phone (E.164) and email, encrypted. */
    phoneCiphertext: encryptedText("phone_ciphertext"),
    emailCiphertext: encryptedText("email_ciphertext"),
    /** A minor's guardian: name, phone (E.164) and email encrypted. */
    guardianNameCiphertext: encryptedText("guardian_name_ciphertext"),
    guardianRelationship: guardianRelationshipEnum("guardian_relationship"),
    guardianPhoneCiphertext: encryptedText("guardian_phone_ciphertext"),
    guardianEmailCiphertext: encryptedText("guardian_email_ciphertext"),
    addressCiphertext: encryptedText("address_ciphertext"),
    /** The student's, or else the institution's, location. */
    pinCode: text("pin_code"),
    city: text(),
    state: text(),
    /**
     * Blind index of the student's normalised name and date of birth
     * (src/server/modules/registration/domain/identity-key.ts): how the
     * same child is recognised without reading the encrypted date.
     */
    identityHash: text("identity_hash").notNull(),
    /** Who first entered the student; null once their account is gone. */
    createdBy: uuid("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check(
      "participant_profile_institution_owner",
      sql`(${table.managingInstitutionId} IS NOT NULL) = (${table.ownerKind} = 'institution')`
    ),
    // A guardian is named in full or not at all.
    check(
      "participant_profile_guardian_complete",
      sql`(${table.guardianNameCiphertext} IS NULL) = (${table.guardianRelationship} IS NULL) AND (${table.guardianNameCiphertext} IS NULL) = (${table.guardianPhoneCiphertext} IS NULL)`
    ),
    check(
      "participant_profile_pin_code_format",
      sql`${table.pinCode} ~ '^[1-9][0-9]{5}$'`
    ),
    // One profile per child at a school.
    uniqueIndex("participant_profile_institution_identity_unique")
      .on(table.managingInstitutionId, table.identityHash)
      .where(sql`${table.managingInstitutionId} IS NOT NULL`),
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("participant_profile_created_by_idx").on(table.createdBy),
  ]
);

export type ParticipantProfile = typeof participantProfile.$inferSelect;

export const registrationRouteEnum = pgEnum(
  "registration_route",
  REGISTRATION_ROUTES
);

/**
 * Enrolled and withdrawn, for now. Payment (#77), refunds (#80) and
 * guardians (#81) append their values in migrations of their own (rule
 * F2); the machine is in
 * src/server/modules/registration/domain/registration-status.ts.
 */
export const registrationStatusEnum = pgEnum(
  "registration_status",
  REGISTRATION_STATUSES
);

/** A participant taking part in one competition, in one age group. */
export const registration = pgTable(
  "registration",
  {
    id: uuid().primaryKey(),
    participantProfileId: uuid("participant_profile_id")
      .notNull()
      .references(() => participantProfile.id),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    route: registrationRouteEnum().notNull(),
    /** The school's registration a student is enrolled under. */
    institutionRegistrationId: uuid("institution_registration_id").references(
      () => institutionRegistration.id
    ),
    /**
     * Where the date of birth and the competition's cut-off put them. The
     * group can't be deleted while a registration holds it.
     */
    ageGroupId: uuid("age_group_id")
      .notNull()
      .references(() => competitionAgeGroup.id),
    status: registrationStatusEnum().notNull(),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check(
      "registration_institution_route",
      sql`(${table.institutionRegistrationId} IS NOT NULL) = (${table.route} = 'institution')`
    ),
    // One live registration per participant and competition; withdrawn
    // ones stay as history.
    uniqueIndex("registration_participant_competition_unique")
      .on(table.participantProfileId, table.competitionId)
      .where(sql`${table.status} <> 'withdrawn'`),
    // The coordinator dashboard lists one school's registration.
    index("registration_institution_registration_id_idx").on(
      table.institutionRegistrationId
    ),
    index("registration_competition_id_idx").on(table.competitionId),
    index("registration_age_group_id_idx").on(table.ageGroupId),
  ]
);

export type Registration = typeof registration.$inferSelect;
