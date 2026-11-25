// What a subject data export holds (#115b), table by table.
//
// The data inventory (../../inventory.ts) says which columns of which
// tables are a person's. Each such table is one of three things here:
//
//   SECTIONS        the person's own rows, read whole: encrypted columns
//                   decrypted, sign-in secrets and keyed hashes left out
//   NOT_EXPORTED    left out on purpose, with the reason (another person's
//                   confidential record, a secret, a test capture)
//   references      every other column the inventory says names an account
//                   directly (who created, decided or wrote a record): the
//                   export lists the ids of the rows that name the person
//
// ./sections.test.ts fails while an inventory table about a person is none
// of the three, so a ticket that adds personal data decides here too.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  and,
  eq,
  getTableColumns,
  inArray,
  is,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";

import * as schema from "../../../../db/schema";
import {
  account,
  auditLog,
  consentEvent,
  consentForm,
  consentLink,
  entry,
  entryFile,
  entryTransition,
  entryVerification,
  physicalArtwork,
  roundEntry,
  roundResult,
  roundAssignment,
  judgeOnboarding,
  artworkPhoto,
  artworkCustodyEvent,
  auctionLot,
  artworkDiscrepancy,
  artworkReturnRequest,
  artworkVerification,
  fileAsset,
  guardian,
  guardianInvitation,
  guardianLink,
  inboxItem,
  INBOX_BODY_PURPOSE,
  INBOX_TITLE_PURPOSE,
  messageDelivery,
  notificationPreference,
  offlinePayment,
  participantProfile,
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  privacyRequest,
  refund,
  registration,
  secondFactor,
  secondFactorLockout,
  session,
  user,
  userRole,
} from "../../../../db/schema";
import { USER_PHONE } from "../../../../identity/stored-phone";
import { LINK_CONTACT } from "../../../consent-links/repository";
import { GUARDIAN_PURPOSE } from "../../../guardians/guardian-record";
import {
  REQUESTED_GUARDIAN_NAME,
  TEEN_CONTACT,
} from "../../../guardians/teen-contact";
import { PROFILE_PURPOSE } from "../../../registration/student-profile";
import { DATA_INVENTORY } from "../../inventory";
import { CONTENT_PURPOSES } from "../content";
import type { SubjectScope } from "./scope";

/** `column IN (ids)`, or nothing at all for no ids. */
export function within(column: PgColumn, ids: readonly string[]): SQL {
  return ids.length === 0 ? sql`false` : inArray(column, [...ids]);
}

export type Section = {
  table: PgTable;
  /** The person's rows. */
  where(scope: SubjectScope): SQL;
  /**
   * The columns that tie a row to the person: each row must name one of
   * the scope's accounts or profiles, or a row an earlier section holds.
   */
  owners: readonly string[];
  /** Encrypted columns and the purpose each is decrypted for. */
  decrypt?: Readonly<Record<string, string>>;
  /** Columns left out: sign-in secrets, keyed hashes, storage keys. */
  withhold?: readonly string[];
};

const users = (scope: SubjectScope) => scope.userIds;
const profiles = (scope: SubjectScope) => scope.profileIds;

/** The person's guardian records (as a guardian of others). */
const guardianIdsOf = (scope: SubjectScope) =>
  sql`(SELECT ${guardian.id} FROM ${guardian} WHERE ${within(guardian.userId, users(scope))})`;

/** The person's entries. */
const entryIdsOf = (scope: SubjectScope) =>
  sql`(SELECT ${entry.id} FROM ${entry} WHERE ${within(entry.participantProfileId, profiles(scope))})`;

/** Payments the person made themselves. */
const paidBatchesOf = (scope: SubjectScope) =>
  sql`(SELECT ${paymentBatch.id} FROM ${paymentBatch} WHERE ${within(paymentBatch.payerUserId, users(scope))})`;

/** The person's registrations. */
const registrationIdsOf = (scope: SubjectScope) =>
  sql`(SELECT ${registration.id} FROM ${registration} WHERE ${within(registration.participantProfileId, profiles(scope))})`;

const PROFILE_DECRYPT = {
  dob_ciphertext: PROFILE_PURPOSE.dob,
  phone_ciphertext: PROFILE_PURPOSE.phone,
  email_ciphertext: PROFILE_PURPOSE.email,
  guardian_name_ciphertext: PROFILE_PURPOSE.guardianName,
  guardian_phone_ciphertext: PROFILE_PURPOSE.guardianPhone,
  guardian_email_ciphertext: PROFILE_PURPOSE.guardianEmail,
  address_ciphertext: PROFILE_PURPOSE.address,
} as const;

/** The person's own rows, in the order the export lists them. */
export const SECTIONS: readonly Section[] = [
  {
    table: user,
    where: (scope) => within(user.id, users(scope)),
    owners: ["id"],
    decrypt: { phone_ciphertext: USER_PHONE },
    withhold: ["phone_hash"],
  },
  {
    table: account,
    where: (scope) => within(account.userId, users(scope)),
    owners: ["user_id"],
    withhold: ["access_token", "refresh_token", "id_token", "password"],
  },
  {
    table: session,
    where: (scope) => within(session.userId, users(scope)),
    owners: ["user_id"],
    withhold: ["token"],
  },
  {
    table: secondFactor,
    where: (scope) => within(secondFactor.userId, users(scope)),
    owners: ["user_id"],
    withhold: ["credential_id", "public_key", "totp_secret_sealed"],
  },
  {
    table: secondFactorLockout,
    where: (scope) => within(secondFactorLockout.userId, users(scope)),
    owners: ["user_id"],
  },
  {
    table: userRole,
    where: (scope) => within(userRole.userId, users(scope)),
    owners: ["user_id"],
  },
  {
    table: notificationPreference,
    where: (scope) => within(notificationPreference.userId, users(scope)),
    owners: ["user_id"],
  },
  {
    table: messageDelivery,
    where: (scope) => within(messageDelivery.userId, users(scope)),
    owners: ["user_id"],
    withhold: ["contact_hash", "recipient_account_hash", "recipient_hashes"],
  },
  {
    table: inboxItem,
    where: (scope) => within(inboxItem.userId, users(scope)),
    owners: ["user_id"],
    decrypt: {
      title_ciphertext: INBOX_TITLE_PURPOSE,
      body_ciphertext: INBOX_BODY_PURPOSE,
    },
  },
  {
    table: participantProfile,
    where: (scope) => within(participantProfile.id, profiles(scope)),
    owners: ["id"],
    decrypt: PROFILE_DECRYPT,
    withhold: ["identity_hash"],
  },
  {
    table: guardian,
    where: (scope) => within(guardian.userId, users(scope)),
    owners: ["user_id"],
    decrypt: {
      full_name_ciphertext: GUARDIAN_PURPOSE.fullName,
      phone_ciphertext: GUARDIAN_PURPOSE.phone,
    },
    withhold: ["phone_hash"],
  },
  {
    table: guardianLink,
    where: (scope) =>
      or(
        within(guardianLink.participantProfileId, profiles(scope)),
        sql`${guardianLink.guardianId} IN ${guardianIdsOf(scope)}`
      )!,
    owners: ["participant_profile_id", "guardian_id"],
  },
  {
    table: guardianInvitation,
    where: (scope) =>
      or(
        within(guardianInvitation.participantProfileId, profiles(scope)),
        within(guardianInvitation.requestedByUserId, users(scope)),
        within(guardianInvitation.acceptedByUserId, users(scope))
      )!,
    owners: [
      "participant_profile_id",
      "requested_by_user_id",
      "accepted_by_user_id",
    ],
    decrypt: {
      contact_ciphertext: TEEN_CONTACT,
      invitee_name_ciphertext: REQUESTED_GUARDIAN_NAME,
    },
    withhold: ["contact_hash", "token_hash", "token_ciphertext"],
  },
  {
    table: consentEvent,
    where: (scope) =>
      or(
        and(
          eq(consentEvent.subjectType, "user"),
          within(consentEvent.subjectId, users(scope))
        ),
        and(
          eq(consentEvent.subjectType, "participant_profile"),
          within(consentEvent.subjectId, profiles(scope))
        ),
        within(consentEvent.giverUserId, users(scope))
      )!,
    owners: ["subject_id", "giver_user_id"],
    withhold: ["giver_contact_hash"],
  },
  {
    table: consentForm,
    where: (scope) => within(consentForm.participantProfileId, profiles(scope)),
    owners: ["participant_profile_id"],
  },
  {
    table: consentLink,
    where: (scope) => within(consentLink.participantProfileId, profiles(scope)),
    owners: ["participant_profile_id"],
    decrypt: { contact_ciphertext: LINK_CONTACT },
    withhold: [
      "contact_hash",
      "token_hash",
      "token_ciphertext",
      "code_hash",
      "session_token_hash",
    ],
  },
  {
    table: registration,
    where: (scope) =>
      within(registration.participantProfileId, profiles(scope)),
    owners: ["participant_profile_id"],
  },
  {
    table: entry,
    where: (scope) => within(entry.participantProfileId, profiles(scope)),
    owners: ["participant_profile_id"],
  },
  {
    table: entryFile,
    where: (scope) => sql`${entryFile.entryId} IN ${entryIdsOf(scope)}`,
    owners: ["entry_id"],
  },
  {
    table: entryTransition,
    where: (scope) => sql`${entryTransition.entryId} IN ${entryIdsOf(scope)}`,
    owners: ["entry_id"],
  },
  {
    table: physicalArtwork,
    where: (scope) => sql`${physicalArtwork.entryId} IN ${entryIdsOf(scope)}`,
    owners: ["entry_id", "registration_id"],
  },
  {
    table: roundEntry,
    where: (scope) =>
      or(
        sql`${roundEntry.entryId} IN ${entryIdsOf(scope)}`,
        within(roundEntry.admittedByUserId, users(scope))
      )!,
    owners: ["entry_id", "admitted_by_user_id"],
    withhold: ["admitted_by_user_id"],
  },
  {
    // Locked rankings contain the entrant's own outcome and score, not
    // judge identities. Include only the subject's entries in the export.
    table: roundResult,
    where: (scope) => sql`${roundResult.entryId} IN ${entryIdsOf(scope)}`,
    owners: ["entry_id"],
  },
  {
    table: roundAssignment,
    // A judge's assignments belong in their rights export, but the private
    // source-entry and other staff identities must never pierce blind judging.
    where: (scope) =>
      or(
        within(roundAssignment.judgeUserId, users(scope)),
        within(roundAssignment.assignedByUserId, users(scope))
      )!,
    owners: ["judge_user_id", "assigned_by_user_id"],
    withhold: ["entry_id", "judge_user_id", "assigned_by_user_id"],
  },
  {
    table: judgeOnboarding,
    where: (scope) => within(judgeOnboarding.judgeUserId, users(scope)),
    owners: ["judge_user_id"],
  },
  {
    table: auctionLot,
    where: (scope) =>
      sql`${auctionLot.artworkId} IN (SELECT ${physicalArtwork.id} FROM ${physicalArtwork} WHERE ${physicalArtwork.entryId} IN ${entryIdsOf(scope)})`,
    owners: ["artwork_id", "consent_event_id", "lot_code"],
    withhold: ["created_by"],
  },
  {
    table: artworkVerification,
    where: (scope) =>
      sql`${artworkVerification.artworkId} IN (SELECT ${physicalArtwork.id} FROM ${physicalArtwork} WHERE ${physicalArtwork.entryId} IN ${entryIdsOf(scope)})`,
    owners: ["artwork_id"],
    withhold: ["verified_by"],
  },
  {
    table: artworkPhoto,
    where: (scope) =>
      sql`${artworkPhoto.artworkId} IN (SELECT ${physicalArtwork.id} FROM ${physicalArtwork} WHERE ${physicalArtwork.entryId} IN ${entryIdsOf(scope)})`,
    owners: ["artwork_id"],
    withhold: ["created_by"],
  },
  {
    table: artworkCustodyEvent,
    where: (scope) =>
      sql`${artworkCustodyEvent.artworkId} IN (SELECT ${physicalArtwork.id} FROM ${physicalArtwork} WHERE ${physicalArtwork.entryId} IN ${entryIdsOf(scope)})`,
    owners: ["artwork_id"],
    withhold: ["actor_user_id"],
  },
  {
    table: artworkDiscrepancy,
    where: (scope) =>
      sql`${artworkDiscrepancy.artworkId} IN (SELECT ${physicalArtwork.id} FROM ${physicalArtwork} WHERE ${physicalArtwork.entryId} IN ${entryIdsOf(scope)})`,
    owners: ["artwork_id"],
    withhold: ["raised_by", "resolved_by"],
  },
  {
    table: artworkReturnRequest,
    where: (scope) =>
      sql`${artworkReturnRequest.artworkId} IN (SELECT ${physicalArtwork.id} FROM ${physicalArtwork} WHERE ${physicalArtwork.entryId} IN ${entryIdsOf(scope)})`,
    owners: ["artwork_id"],
    withhold: ["requested_by"],
  },
  {
    table: entryVerification,
    where: (scope) => sql`${entryVerification.entryId} IN ${entryIdsOf(scope)}`,
    owners: ["entry_id"],
    withhold: ["decided_by_user_id", "resubmitted_by_user_id"],
  },
  {
    table: fileAsset,
    where: (scope) =>
      or(
        within(fileAsset.ownerUserId, users(scope)),
        sql`${fileAsset.id} IN (SELECT ${artworkPhoto.fileAssetId} FROM ${artworkPhoto} INNER JOIN ${physicalArtwork} ON ${physicalArtwork.id} = ${artworkPhoto.artworkId} WHERE ${physicalArtwork.entryId} IN ${entryIdsOf(scope)})`,
        sql`${fileAsset.id} IN (SELECT ${entryFile.fileAssetId} FROM ${entryFile} WHERE ${entryFile.entryId} IN ${entryIdsOf(scope)})`,
        sql`${fileAsset.id} IN (SELECT ${consentForm.fileAssetId} FROM ${consentForm} WHERE ${within(consentForm.participantProfileId, profiles(scope))})`
      )!,
    owners: ["owner_user_id", "id"],
    withhold: ["bucket", "storage_key", "owner_user_id"],
  },
  {
    // A school's payment names many students: only the person's own items.
    table: paymentBatchItem,
    where: (scope) =>
      or(
        sql`${paymentBatchItem.registrationId} IN ${registrationIdsOf(scope)}`,
        sql`${paymentBatchItem.batchId} IN ${paidBatchesOf(scope)}`
      )!,
    owners: ["registration_id", "batch_id"],
  },
  {
    table: paymentBatch,
    where: (scope) =>
      or(
        within(paymentBatch.payerUserId, users(scope)),
        sql`${paymentBatch.id} IN (SELECT ${paymentBatchItem.batchId} FROM ${paymentBatchItem} WHERE ${paymentBatchItem.registrationId} IN ${registrationIdsOf(scope)})`
      )!,
    owners: ["payer_user_id", "id"],
  },
  {
    table: offlinePayment,
    where: (scope) => sql`${offlinePayment.batchId} IN ${paidBatchesOf(scope)}`,
    owners: ["batch_id"],
  },
  {
    table: paymentReviewCase,
    where: (scope) =>
      sql`${paymentReviewCase.batchId} IN ${paidBatchesOf(scope)}`,
    owners: ["batch_id"],
  },
  {
    table: refund,
    where: (scope) => sql`${refund.batchId} IN ${paidBatchesOf(scope)}`,
    owners: ["batch_id"],
  },
  {
    table: privacyRequest,
    where: (scope) =>
      or(
        and(
          eq(privacyRequest.subjectKind, "user"),
          within(privacyRequest.subjectId, users(scope))
        ),
        and(
          eq(privacyRequest.subjectKind, "participant_profile"),
          within(privacyRequest.subjectId, profiles(scope))
        ),
        within(privacyRequest.requestedByUserId, users(scope))
      )!,
    owners: ["subject_id", "requested_by_user_id"],
    decrypt: {
      correction_details_ciphertext: CONTENT_PURPOSES.correctionDetails,
      rejection_reason_ciphertext: CONTENT_PURPOSES.rejectionReason,
      resolution_ciphertext: CONTENT_PURPOSES.resolution,
    },
    withhold: ["export_storage_key", "erasure_fingerprint"],
  },
  {
    // What the person did on the platform; before and after name other
    // records' ids, so the export keeps what, when and from where.
    table: auditLog,
    where: (scope) => within(auditLog.actorUserId, users(scope)),
    owners: ["actor_user_id"],
    withhold: ["before", "after"],
  },
];

/** Tables about people that the export leaves out, and why. */
export const NOT_EXPORTED: Readonly<Record<string, string>> = {
  verification: "sign_in_secret",
  otp_rate_limit: "keyed_hash_only",
  form_rate_limit: "keyed_hash_only",
  captured_message: "test_capture",
  outbox: "background_job",
  safeguarding_report: "safeguarding_confidential",
  safeguarding_incident_log: "safeguarding_confidential",
  breach_record: "breach_log",
  breach_timeline_event: "breach_log",
  breach_notification: "breach_log",
  breach_fan_out: "breach_log",
  breach_unreachable: "breach_log",
  legal_hold: "legal_hold_confidential",
  privacy_request_note: "internal_notes",
  file_derivative: "part_of_file_asset",
  consent_form_upload: "part_of_consent_form",
  entry_upload_grant: "part_of_entry",
  // Which staff member last changed a competition's settings or a site
  // setting: rows with no id of their own to list.
  competition_award_scheme: "staff_last_change",
  competition_consent_document: "staff_last_change",
  competition_fee: "staff_last_change",
  setting: "staff_last_change",
  // Which finance user last locked or reopened a ledger month (#109):
  // rows keyed by month, with no id to list.
  ledger_period: "staff_last_change",
  // Which coordinator picked an entry for a school's shortlist (#89): keyed
  // by the entry, with no id of its own to list.
  school_round_pick: "coordinator_pick",
  // Which coordinator declared a shortlisted entry they created (#91):
  // keyed by the entry, with no id of its own to list.
  school_round_declaration: "coordinator_pick",
  // Private judging assessments can name both a judge and a participant.
  // An officer handles requests without identifying the other person or
  // disclosing an unfinished result.
  score_sheet: "confidential_judging_assessment",
  criterion_score: "confidential_judging_assessment",
  // Written when a person's data is erased: there is nothing left to export.
  erasure_record: "erasure_proof",
};

/** Every table in the schema, by name. */
export const TABLES_BY_NAME: ReadonlyMap<string, PgTable> = new Map(
  (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => [getTableConfig(table).name, table])
);

/** A section's table name. */
export function sectionName(section: Section): string {
  return getTableConfig(section.table).name;
}

const SECTION_OWNERS = new Set(
  SECTIONS.flatMap((section) =>
    section.owners.map((owner) => `${sectionName(section)}.${owner}`)
  )
);

/**
 * The inventory's columns that name an account directly, outside what a
 * section already selects by: the export lists the ids of rows naming the
 * person there.
 */
export const REFERENCE_COLUMNS: readonly { table: string; column: string }[] =
  DATA_INVENTORY.filter(
    (entry) =>
      entry.subject.kind === "user" &&
      entry.subject.via === entry.column &&
      !Object.hasOwn(NOT_EXPORTED, entry.table) &&
      !SECTION_OWNERS.has(`${entry.table}.${entry.column}`) &&
      TABLES_BY_NAME.has(entry.table) &&
      "id" in getTableColumns(TABLES_BY_NAME.get(entry.table)!)
  ).map(({ table, column }) => ({ table, column }));

/** The property and column of `table` stored as `sqlName`. */
export function columnNamed(table: PgTable, sqlName: string): PgColumn {
  const found = Object.values(getTableColumns(table)).find(
    (column) => column.name === sqlName
  );
  if (!found) {
    throw new Error(`${getTableConfig(table).name} has no column ${sqlName}`);
  }
  return found as PgColumn;
}
