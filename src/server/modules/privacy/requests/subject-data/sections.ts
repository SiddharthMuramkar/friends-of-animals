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
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";

import * as schema from "../../../../db/schema";
import {
  account,
  communityMember,
  surveyInvitation,
  competitionInvitation,
  eventRegistration,
  engagementMilestone,
  timelineEntry,
  auditLog,
  consentEvent,
  consentForm,
  consentLink,
  donation,
  donor,
  receipt,
  recurringDonation,
  entry,
  entryFile,
  entryTransition,
  entryVerification,
  physicalArtwork,
  roundEntry,
  roundAssignment,
  judgeOnboarding,
  artworkPhoto,
  artworkCustodyEvent,
  auctionLot,
  auctionBid,
  auctionOffer,
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
import { WORK_PURPOSES } from "../../../volunteers/work-fields";
import {
  DATE_OF_BIRTH_PURPOSE,
  DECLINE_REASON_PURPOSE,
} from "../../../volunteers/application-record";
import { COMMUNITY_MEMBER_PURPOSE } from "../../../community/profile-fields";
import { USER_PHONE } from "../../../../identity/stored-phone";
import { DONOR_PURPOSE } from "../../../donations/donors";
import { LINK_CONTACT } from "../../../consent-links/repository";
import { ENTRY_FILE_PURPOSES } from "../../../files/domain/purposes";
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
  /** Explicit export field allowlist (SQL names); new financial columns stay private by default. */
  include?: readonly string[];
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

/** Ownership comes from the account link, never a matching email address. */
const donorIdsOf = (scope: SubjectScope) =>
  sql`(SELECT ${donor.id} FROM ${donor} WHERE ${within(donor.userId, users(scope))})`;

const donationIdsOf = (scope: SubjectScope) =>
  sql`(SELECT ${donation.id} FROM ${donation} WHERE ${donation.donorId} IN ${donorIdsOf(scope)})`;

const PROFILE_DECRYPT = {
  dob_ciphertext: PROFILE_PURPOSE.dob,
  phone_ciphertext: PROFILE_PURPOSE.phone,
  email_ciphertext: PROFILE_PURPOSE.email,
  guardian_name_ciphertext: PROFILE_PURPOSE.guardianName,
  guardian_phone_ciphertext: PROFILE_PURPOSE.guardianPhone,
  guardian_email_ciphertext: PROFILE_PURPOSE.guardianEmail,
  address_ciphertext: PROFILE_PURPOSE.address,
} as const;

/** An uploader can act for another person; these assets belong to the participant. */
export const PARTICIPANT_FILE_PURPOSES = [
  ...ENTRY_FILE_PURPOSES,
  "consent_form",
  "artwork_condition_photo",
  "certificate_pdf",
] as const;

/** The person's own rows, in the order the export lists them. */
export const SECTIONS: readonly Section[] = [
  {
    table: schema.club,
    where: (scope) => within(schema.club.applicantUserId, users(scope)),
    owners: ["applicant_user_id"],
  },
  {
    table: schema.clubDecision,
    where: (scope) =>
      sql`${schema.clubDecision.clubId} IN (SELECT ${schema.club.id} FROM ${schema.club} WHERE ${within(schema.club.applicantUserId, users(scope))})`,
    owners: ["club_id"],
    decrypt: { reason_ciphertext: "club_decision.reason" },
    withhold: ["decided_by_user_id"],
  },
  {
    table: schema.clubMembership,
    where: (scope) => within(schema.clubMembership.userId, users(scope)),
    owners: ["user_id"],
  },
  {
    table: competitionInvitation,
    where: (scope) =>
      or(
        within(competitionInvitation.participantProfileId, profiles(scope)),
        within(competitionInvitation.recipientUserId, users(scope))
      )!,
    owners: ["participant_profile_id", "recipient_user_id"],
    withhold: ["recipient_user_id"],
  },
  {
    table: surveyInvitation,
    where: (scope) => within(surveyInvitation.userId, users(scope)),
    owners: ["user_id"],
    withhold: ["token_hash"],
  },
  {
    table: eventRegistration,
    where: (scope) =>
      or(
        within(eventRegistration.subjectUserId, users(scope)),
        within(eventRegistration.subjectProfileId, profiles(scope))
      )!,
    owners: ["subject_user_id", "subject_profile_id"],
    withhold: [
      "registered_by_user_id",
      "checked_in_by_user_id",
      "waitlist_order",
    ],
  },
  {
    table: communityMember,
    where: (scope) =>
      or(
        within(communityMember.subjectUserId, users(scope)),
        within(communityMember.subjectProfileId, profiles(scope))
      )!,
    owners: ["subject_user_id", "subject_profile_id"],
    decrypt: {
      display_name_ciphertext: COMMUNITY_MEMBER_PURPOSE.displayName,
      about_ciphertext: COMMUNITY_MEMBER_PURPOSE.about,
    },
    withhold: ["joined_by_user_id"],
  },
  {
    table: engagementMilestone,
    where: (scope) =>
      or(
        within(engagementMilestone.subjectUserId, users(scope)),
        within(engagementMilestone.subjectProfileId, profiles(scope))
      )!,
    owners: ["subject_user_id", "subject_profile_id"],
  },
  {
    table: timelineEntry,
    where: (scope) =>
      or(
        within(timelineEntry.subjectUserId, users(scope)),
        within(timelineEntry.subjectProfileId, profiles(scope))
      )!,
    owners: ["subject_user_id", "subject_profile_id"],
    withhold: ["source_key"],
  },
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
    table: schema.volunteerApplication,
    where: (scope) =>
      within(schema.volunteerApplication.applicantUserId, users(scope)),
    owners: ["applicant_user_id"],
    decrypt: {
      date_of_birth_ciphertext: DATE_OF_BIRTH_PURPOSE,
      decline_reason_ciphertext: DECLINE_REASON_PURPOSE,
    },
    withhold: ["guardian_user_id", "decided_by_user_id"],
  },
  {
    table: schema.volunteerTask,
    where: (scope) =>
      within(schema.volunteerTask.createdByUserId, users(scope)),
    owners: ["created_by_user_id"],
    decrypt: {
      title_ciphertext: WORK_PURPOSES.title,
      description_ciphertext: WORK_PURPOSES.description,
    },
  },
  {
    table: schema.volunteerTaskAssignment,
    where: (scope) =>
      within(schema.volunteerTaskAssignment.volunteerUserId, users(scope)),
    owners: ["volunteer_user_id"],
    withhold: ["assigned_by_user_id"],
  },
  {
    table: schema.volunteerHoursEntry,
    where: (scope) =>
      sql`${schema.volunteerHoursEntry.assignmentId} IN (SELECT ${schema.volunteerTaskAssignment.id} FROM ${schema.volunteerTaskAssignment} WHERE ${within(schema.volunteerTaskAssignment.volunteerUserId, users(scope))})`,
    owners: ["assignment_id"],
    decrypt: {
      note_ciphertext: WORK_PURPOSES.note,
      reject_reason_ciphertext: WORK_PURPOSES.reason,
    },
    withhold: ["decided_by_user_id"],
  },
  {
    table: schema.galleryItem,
    where: (scope) =>
      sql`${schema.galleryItem.entryId} IN ${entryIdsOf(scope)}`,
    owners: ["entry_id"],
    withhold: ["file_id", "consent_event_id"],
  },
  {
    table: schema.socialExport,
    where: (scope) =>
      sql`${schema.socialExport.galleryItemId} IN (SELECT ${schema.galleryItem.id} FROM ${schema.galleryItem} WHERE ${schema.galleryItem.entryId} IN ${entryIdsOf(scope)})`,
    owners: ["gallery_item_id"],
    decrypt: { caption_ciphertext: "social_export.caption" },
    withhold: [
      "file_id",
      "gallery_consent_event_id",
      "social_consent_event_id",
    ],
  },
  {
    table: schema.certificate,
    where: (scope) =>
      or(
        within(schema.certificate.participantProfileId, profiles(scope)),
        within(schema.certificate.recipientUserId, users(scope))
      )!,
    owners: ["participant_profile_id", "recipient_user_id"],
    withhold: ["revoked_by_user_id", "revoked_reason"],
  },
  {
    table: schema.resultAward,
    where: (scope) =>
      sql`${schema.resultAward.entryId} IN ${entryIdsOf(scope)} AND ${schema.resultAward.releaseId} IN (SELECT ${schema.resultRelease.id} FROM ${schema.resultRelease} WHERE ${schema.resultRelease.status} = 'published')`,
    owners: ["entry_id"],
    withhold: ["suitable_for_auction"],
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
    table: auctionBid,
    where: (scope) => within(auctionBid.bidderUserId, users(scope)),
    owners: ["bidder_user_id"],
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
        and(
          within(fileAsset.ownerUserId, users(scope)),
          notInArray(fileAsset.purpose, [...PARTICIPANT_FILE_PURPOSES])
        ),
        sql`${fileAsset.id} IN (SELECT ${schema.certificate.pdfFileId} FROM ${schema.certificate} WHERE ${or(within(schema.certificate.participantProfileId, profiles(scope)), within(schema.certificate.recipientUserId, users(scope)))})`,
        sql`${fileAsset.id} IN (SELECT ${artworkPhoto.fileAssetId} FROM ${artworkPhoto} INNER JOIN ${physicalArtwork} ON ${physicalArtwork.id} = ${artworkPhoto.artworkId} WHERE ${physicalArtwork.entryId} IN ${entryIdsOf(scope)})`,
        sql`${fileAsset.id} IN (SELECT ${entryFile.fileAssetId} FROM ${entryFile} WHERE ${entryFile.entryId} IN ${entryIdsOf(scope)})`,
        sql`${fileAsset.id} IN (SELECT ${consentForm.fileAssetId} FROM ${consentForm} WHERE ${within(consentForm.participantProfileId, profiles(scope))})`
      )!,
    owners: ["owner_user_id", "id"],
    withhold: ["bucket", "storage_key", "owner_user_id"],
  },
  {
    // The payment batch belongs to its payer. A participant whose fee was
    // paid by someone else gets their own item, not the shared batch total.
    table: paymentBatch,
    where: (scope) => within(paymentBatch.payerUserId, users(scope)),
    owners: ["payer_user_id"],
  },
  {
    table: auctionOffer,
    where: (scope) =>
      or(
        sql`${auctionOffer.bidId} IN (SELECT ${auctionBid.id} FROM ${auctionBid} WHERE ${within(auctionBid.bidderUserId, users(scope))})`,
        sql`${auctionOffer.batchId} IN ${paidBatchesOf(scope)}`,
        and(
          eq(auctionOffer.status, "paid"),
          sql`${auctionOffer.lotId} IN (SELECT ${auctionLot.id} FROM ${auctionLot} JOIN ${physicalArtwork} ON ${physicalArtwork.id}=${auctionLot.artworkId} WHERE ${physicalArtwork.entryId} IN ${entryIdsOf(scope)})`
        )
      )!,
    owners: ["bid_id", "batch_id", "lot_id"],
    decrypt: { address_ciphertext: "auction_offer.address" },
  },
  {
    table: paymentBatchItem,
    where: (scope) =>
      or(
        sql`${paymentBatchItem.registrationId} IN ${registrationIdsOf(scope)}`,
        sql`${paymentBatchItem.batchId} IN ${paidBatchesOf(scope)}`
      )!,
    owners: ["registration_id", "batch_id"],
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
    table: donor,
    where: (scope) => within(donor.userId, users(scope)),
    owners: ["user_id"],
    include: [
      "id",
      "user_id",
      "type",
      "name_ciphertext",
      "email_ciphertext",
      "pan_ciphertext",
      "organisation_name",
      "disclose_organisation",
      "created_at",
    ],
    decrypt: {
      name_ciphertext: DONOR_PURPOSE.name,
      email_ciphertext: DONOR_PURPOSE.email,
      pan_ciphertext: DONOR_PURPOSE.pan,
    },
  },
  {
    table: recurringDonation,
    where: (scope) =>
      or(
        within(recurringDonation.userId, users(scope)),
        sql`${recurringDonation.donorId} IN ${donorIdsOf(scope)}`
      )!,
    owners: ["user_id", "donor_id"],
    include: [
      "id",
      "donor_id",
      "user_id",
      "amount_minor",
      "status",
      "show_on_wall",
      "wall_name",
      "next_charge_at",
      "cancel_requested_at",
      "cancel_requested_by",
      "cancelled_at",
      "cancelled_by",
      "created_at",
      "updated_at",
    ],
  },
  {
    table: donation,
    where: (scope) => sql`${donation.donorId} IN ${donorIdsOf(scope)}`,
    owners: ["donor_id"],
    // No checkout hash, gateway identifiers, or internal finance proof.
    include: [
      "id",
      "donor_id",
      "origin",
      "status",
      "amount_minor",
      "currency",
      "show_on_wall",
      "wall_name",
      "declared_adult",
      "declared_indian_source",
      "payment_batch_id",
      "recurring_donation_id",
      "expires_at",
      "offline_method",
      "offline_reference",
      "offline_received_on",
      "captured_at",
      "created_at",
      "updated_at",
    ],
  },
  {
    table: receipt,
    where: (scope) => sql`${receipt.donationId} IN ${donationIdsOf(scope)}`,
    owners: ["donation_id"],
    // Frozen printed receipt, not the bearer links that open it.
    include: [
      "id",
      "donation_id",
      "fy",
      "seq",
      "number",
      "issued_at",
      "snapshot",
      "template_version",
      "cancelled_at",
    ],
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
  gallery_report: "third_party_confidential_report",
  certificate_ready_notice: "background_job",
  certificate_archive: "mixed_subject_temporary_archive",
  verification: "sign_in_secret",
  receipt_link: "receipt_bearer_link",
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
  // Locking a round freezes the internal assessment; it does not publish
  // a result. #99's two-person release can expose approved outcomes only.
  round_result: "unpublished_judging_result",
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
      (!SECTION_OWNERS.has(`${entry.table}.${entry.column}`) ||
        // Uploader-only files may belong to a participant, not the uploader.
        (entry.table === "file_asset" && entry.column === "owner_user_id")) &&
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
