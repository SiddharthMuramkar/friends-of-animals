// The domain events use cases emit, and which handlers each one goes to.
// Adding an event: add it to `DomainEvent`, give it a payload schema in
// EVENT_PAYLOADS, and list its handlers in SUBSCRIBERS (each name then
// needs an implementation in ./handlers.ts).
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import { z } from "zod";

import {
  FEE_RETURNS,
  type FeeReturn,
} from "../modules/competitions/domain/cancellation";
import {
  KEY_DATE_KINDS,
  type KeyDateKind,
} from "../modules/competitions/domain/key-dates";
import {
  DISCIPLINES,
  type Discipline,
} from "../modules/competitions/domain/vocabulary";
import {
  CONSENT_SUBJECT_TYPES,
  WITHDRAWABLE_PURPOSES,
  type ConsentSubjectType,
  type WithdrawablePurpose,
} from "../modules/consent/domain/purposes";
import { FILE_PROCESSING_ERROR_CODES } from "../ports/media";
import { BREACH_FAN_OUT_PAGE_SIZE } from "../modules/breaches/domain/notice-recipients";

/**
 * FOA staff decided about an institution (#73). `userId` is its authorised
 * person, who registered it.
 */
type InstitutionDecided<T extends `institution.${string}`> = {
  type: T;
  aggregate: { type: "institution"; id: string };
  payload: { institutionId: string; userId: string };
};

/**
 * Something happened to an NGO directory listing (#127). `userId` is the
 * person who registered it, who hears of FOA's decisions.
 */
type DirectoryListingEvent<T extends `directory.${string}`> = {
  type: T;
  aggregate: { type: "directory_listing"; id: string };
  payload: { listingId: string; userId: string };
};

/** One verification decision on an entry (#92). */
type EntryVerificationPayload = {
  entryId: string;
  registrationId: string;
  /** The school route's institution registration; null on the individual route. */
  institutionRegistrationId: string | null;
  verificationId: string;
};

export type DomainEvent =
  /** A listing was registered, or renamed and sent back for review. */
  | DirectoryListingEvent<"directory.listing_submitted">
  /** FOA verified it: it is public, and its owner represents it. */
  | DirectoryListingEvent<"directory.listing_verified">
  /** FOA couldn't accept it; its owner may register again. */
  | DirectoryListingEvent<"directory.listing_rejected">
  /** Hidden from the public for now; its representatives keep the role. */
  | DirectoryListingEvent<"directory.listing_suspended">
  /** Public again after a suspension. */
  | DirectoryListingEvent<"directory.listing_reinstated">
  | {
      type: "consent.form_reviewed";
      aggregate: { type: "consent_form"; id: string };
      payload: { formId: string; uploaderUserId: string };
    }
  | {
      type: "consent.link_sent";
      aggregate: { type: "consent_link"; id: string };
      payload: { linkId: string };
    }
  | {
      type: "identity.user_signed_up";
      aggregate: { type: "user"; id: string };
      payload: { userId: string };
    }
  | {
      /** An upload matched its declaration and awaits its malware scan. */
      type: "files.file_uploaded";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
    }
  | {
      /**
       * Someone withdrew consent (#64), or a guardian withdrew a child's
       * (#82); later modules (gallery, social, auction) stop what it
       * allowed.
       */
      type: "consent.withdrawn";
      aggregate: { type: "consent_event"; id: string };
      payload: {
        consentEventId: string;
        subjectType: ConsentSubjectType;
        subjectId: string;
        purpose: WithdrawablePurpose;
        documentId: string;
        /** The competition a child's consent was for; null otherwise. */
        competitionId: string | null;
      };
    }
  | {
      /** A clean file has derivatives to make: worker-media's job (#85). */
      type: "files.processing_requested";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
    }
  | {
      /** A clean video has a copy and a poster to make: worker-media's job (#86). */
      type: "files.video_processing_requested";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
    }
  | {
      /** A clean essay PDF needs a safe blind-judging copy (#96). */
      type: "files.pdf_processing_requested";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
    }
  | {
      /**
       * The scan passed a file that gets no derivatives: it is ready as
       * stored (a payment proof, for example).
       */
      type: "files.file_ready";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
    }
  | {
      /** Every derivative of the file is stored. */
      type: "files.file_processed";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
    }
  | {
      /** The file's derivatives can't be made, for good. */
      type: "files.file_processing_failed";
      aggregate: { type: "file_asset"; id: string };
      payload: {
        fileId: string;
        code: (typeof FILE_PROCESSING_ERROR_CODES)[number];
      };
    }
  | {
      /** The malware scan flagged the file: it is never delivered (#85). */
      type: "files.file_quarantined";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
    }
  | {
      /** Its bytes aren't the type it was declared as: deleted (#85). */
      type: "files.file_rejected";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
    }
  | {
      /** The upload grant and any staged bytes are cleared when it expires. */
      type: "entry.upload_grant_issued";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
    }
  | {
      /** Clears staging bytes from PUTs still in flight at grant expiry. */
      type: "entry.sweep_staged_upload";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
    }
  | {
      /**
       * An entry's first file passed its checks (#85): the entry is
       * submitted and its participant, or their guardian, is told.
       */
      type: "entry.submitted";
      aggregate: { type: "entry"; id: string };
      payload: { entryId: string; entryFileId: string; registrationId: string };
    }
  | {
      /**
       * An entry's upload was flagged by the malware scan (#85). The first
       * file's rejects the entry; a replacement's leaves it as it was.
       */
      type: "entry.file_rejected";
      aggregate: { type: "entry"; id: string };
      payload: {
        entryId: string;
        entryFileId: string;
        registrationId: string;
        replacement: boolean;
      };
    }
  | {
      /**
       * An entry's upload couldn't be processed (#85): corrupt, or not
       * really a picture. The first file's fails the entry; a
       * replacement's leaves it as it was.
       */
      type: "entry.file_failed";
      aggregate: { type: "entry"; id: string };
      payload: {
        entryId: string;
        entryFileId: string;
        registrationId: string;
        replacement: boolean;
      };
    }
  /** Verified for the first time: it has its Institution ID. */
  | InstitutionDecided<"institution.verified">
  /** Its registration wasn't accepted; the person may register again. */
  | InstitutionDecided<"institution.rejected">
  /** Suspended for now; it keeps its Institution ID and its admin. */
  | InstitutionDecided<"institution.suspended">
  /** Verified again after a suspension, with the Institution ID it had. */
  | InstitutionDecided<"institution.reinstated">
  | {
      /**
       * A published competition's key date was set for `dueAt` (#71), on
       * publishing or by an edit. Saved with `availableAt: dueAt`, so its
       * status job runs once the date arrives.
       */
      type: "competitions.key_date_scheduled";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string; kind: KeyDateKind; dueAt: string };
    }
  | {
      /**
       * A competition manager published a competition (#70). Its reminders
       * are scheduled from its key dates (#84).
       */
      type: "competition.published";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string };
    }
  | {
      /**
       * A published competition's key dates were edited (#71): its
       * reminders follow the new dates (#84).
       */
      type: "competition.key_dates_changed";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string };
    }
  | {
      /** A competition was cancelled (#80): its reminders are cancelled (#84). */
      type: "competition.cancelled";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string };
    }
  | {
      /**
       * A planned reminder's fire time (#84). Saved with `availableAt:
       * fire_at`; the run checks the reminder_job row and who owes its
       * deadline then.
       */
      type: "reminder.due";
      aggregate: { type: "reminder_job"; id: string };
      payload: { reminderJobId: string };
    }
  | {
      type: "judging.judge_invited";
      aggregate: { type: "judge_invitation"; id: string };
      payload: { invitationId: string };
    }
  | {
      /** An authorised person invited a coordinator (#74). */
      type: "institution.coordinator_invited";
      aggregate: { type: "institution_invitation"; id: string };
      payload: { invitationId: string };
    }
  | {
      /** A message arrived through the contact form (#113). */
      type: "contact_message.received";
      aggregate: { type: "contact_message"; id: string };
      payload: { messageId: string };
    }
  | {
      /**
       * Someone reported a safeguarding concern (#116). The leads' alert
       * says only that one came in: nothing of the report travels here.
       */
      type: "safeguarding.report_submitted";
      aggregate: { type: "safeguarding_report"; id: string };
      payload: { reportId: string };
    }
  | {
      /**
       * A post was scheduled for `publishAt` (#112). Saved with
       * `availableAt: publishAt`, so its publish job runs at the instant.
       */
      type: "cms.post_scheduled";
      aggregate: { type: "cms_post"; id: string };
      payload: { postId: string; publishAt: string };
    }
  | {
      /** A post went live, by hand or at its scheduled instant (#112). */
      type: "cms.post_published";
      aggregate: { type: "cms_post"; id: string };
      payload: { postId: string };
    }
  | {
      /**
       * A guard refused a scheduled move of the competition (#88): the
       * open competition_transition_block row `blockId` says why. Emitted
       * once per refused move, so its managers are told once.
       */
      type: "competition.transition_blocked";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string; blockId: string };
    }
  | {
      /**
       * A competition manager published a rubric (#88). A move of its
       * competition the guards refused is tried again.
       */
      type: "rubric.published";
      aggregate: { type: "rubric"; id: string };
      payload: {
        rubricId: string;
        competitionId: string;
        discipline: Discipline;
        version: number;
      };
    }
  | {
      /**
       * A competition manager changed the disciplines of a competition
       * whose move a guard refused (#88). The move is tried again, since
       * the disciplines are what the school-judging guard checks. Not
       * emitted while no move is refused: nothing else needs it yet.
       */
      type: "competition.disciplines_changed";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string };
    }
  | {
      /**
       * A competition entered school judging (#89): its school rounds
       * open.
       */
      type: "competition.school_judging_started";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string };
    }
  | {
      /**
       * A coordinator finalised their school round (#89). The only
       * producer is finaliseSchoolRound: each entry of the round is now
       * school-shortlisted (and, under all-participants scope, submitted to
       * FOA) or not shortlisted, and its family is told which.
       */
      type: "school_round.shortlist_finalised";
      aggregate: { type: "school_round"; id: string };
      payload: {
        roundId: string;
        competitionId: string;
        institutionRegistrationId: string;
      };
    }
  | {
      /**
       * A competition manager closed an overdue school round on the
       * school's behalf (#90), applying its saved picks. Not
       * shortlist-finalised: only the school finalises. Each family is
       * told the outcome as after finalising.
       */
      type: "school_round.closed_on_behalf";
      aggregate: { type: "school_round"; id: string };
      payload: {
        roundId: string;
        competitionId: string;
        institutionRegistrationId: string;
      };
    }
  | {
      /**
       * The shortlist deadline passed with the school round unfinished
       * (#90): its coordinators are told it is overdue.
       */
      type: "school_round.overdue";
      aggregate: { type: "school_round"; id: string };
      payload: {
        roundId: string;
        competitionId: string;
        institutionRegistrationId: string;
      };
    }
  | {
      /**
       * A competition's submissions closed (#92): its status job for the
       * submissions_close key date ran. Individual entries go on to FOA.
       */
      type: "competition.submissions_closed";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string };
    }
  | {
      type: "artwork.requested";
      aggregate: { type: "physical_artwork"; id: string };
      payload: { artworkId: string };
    }
  | {
      type: "artwork.dispatched";
      aggregate: { type: "physical_artwork"; id: string };
      payload: { artworkId: string; late: boolean };
    }
  | {
      type: "artwork.received";
      aggregate: { type: "physical_artwork"; id: string };
      payload: { artworkId: string; dispatchRecorded: boolean };
    }
  | {
      type: "artwork.verified";
      aggregate: { type: "physical_artwork"; id: string };
      payload: { artworkId: string };
    }
  | {
      type: "artwork.discrepancy_raised";
      aggregate: { type: "physical_artwork"; id: string };
      payload: { artworkId: string };
    }
  | {
      type: "artwork.discrepancy_resolved";
      aggregate: { type: "physical_artwork"; id: string };
      payload: { artworkId: string };
    }
  | {
      type: "artwork.exhibited";
      aggregate: { type: "physical_artwork"; id: string };
      payload: { artworkId: string };
    }
  | {
      type: "artwork.stored";
      aggregate: { type: "physical_artwork"; id: string };
      payload: { artworkId: string };
    }
  | {
      type: "artwork.retained";
      aggregate: { type: "physical_artwork"; id: string };
      payload: { artworkId: string };
    }
  | {
      type: "artwork.return_requested";
      aggregate: { type: "physical_artwork"; id: string };
      payload: { artworkId: string };
    }
  | {
      type: "artwork.returned";
      aggregate: { type: "physical_artwork"; id: string };
      payload: { artworkId: string };
    }
  | {
      type: "results.release_due";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string; releaseId: string };
    }
  | {
      type: "results.prize_awarded";
      aggregate: { type: "competition"; id: string };
      payload: {
        competitionId: string;
        releaseId: string;
        entryId: string;
        registrationId: string;
      };
    }
  | {
      /** Actual public release, emitted transactionally by Results (#99). */
      type: "results.published";
      aggregate: { type: "competition"; id: string };
      payload: {
        competitionId: string;
        releaseId: string;
        publishedAt: string;
      };
    }
  | {
      type: "auction.lot_created";
      aggregate: { type: "auction_lot"; id: string };
      payload: { lotId: string };
    }
  | {
      type: "auction.lot.open";
      aggregate: { type: "auction_lot"; id: string };
      payload: { lotId: string };
    }
  | {
      type: "auction.lot.close";
      aggregate: { type: "auction_lot"; id: string };
      payload: { lotId: string };
    }
  | {
      type: "auction.lot_opened";
      aggregate: { type: "auction_lot"; id: string };
      payload: { lotId: string };
    }
  | {
      type: "auction.lot_closed";
      aggregate: { type: "auction_lot"; id: string };
      payload: { lotId: string };
    }
  | {
      type: "auction.lot_cancelled";
      aggregate: { type: "auction_lot"; id: string };
      payload: { lotId: string };
    }
  | {
      type: "artwork.retain_unrequested";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string };
    }
  | {
      /**
       * An FOA verifier verified an entry (#92). The participant or their
       * guardian is told; on the school route, its coordinators.
       */
      type: "entry.foa_verified";
      aggregate: { type: "entry"; id: string };
      payload: EntryVerificationPayload;
    }
  | {
      /**
       * An FOA verifier sent an entry back with a reason (#92); whoever can
       * resubmit it is told the reason and the deadline.
       */
      type: "entry.sent_back";
      aggregate: { type: "entry"; id: string };
      payload: EntryVerificationPayload;
    }
  | {
      /**
       * A replacement file of a sent-back entry went live (#92): the entry
       * returns to FOA if it was resubmitted with that file.
       */
      type: "entry.replacement_live";
      aggregate: { type: "entry"; id: string };
      payload: { entryId: string; entryFileId: string };
    }
  | {
      /** An entry was shortlisted in a finalised school round (#89). */
      type: "entry.school_shortlisted";
      aggregate: { type: "entry"; id: string };
      payload: {
        entryId: string;
        registrationId: string;
        roundId: string;
        position?: number | null;
      };
    }
  | {
      /** An entry was not shortlisted in a finalised school round (#89). */
      type: "entry.not_shortlisted";
      aggregate: { type: "entry"; id: string };
      payload: {
        entryId: string;
        registrationId: string;
        roundId: string;
        position?: number | null;
      };
    }
  | {
      /** A confirmed student was not shortlisted, and had no entry (#91). */
      type: "registration.not_shortlisted";
      aggregate: { type: "registration"; id: string };
      payload: { registrationId: string; roundId: string };
    }
  | {
      /** An institution registered for a competition (#75). */
      type: "registration.institution_registered";
      aggregate: { type: "institution_registration"; id: string };
      payload: { institutionRegistrationId: string };
    }
  | {
      /**
       * A registration was confirmed, paid or free, and has its number
       * (#77). Its family contact is told.
       */
      type: "registration.confirmed";
      aggregate: { type: "registration"; id: string };
      payload: { registrationId: string };
    }
  | {
      /**
       * The gateway captured a batch's payment in full (#77). `payerUserId`
       * started the payment and gets the receipt; null once their account
       * is gone.
       */
      type: "payment.batch_captured";
      aggregate: { type: "payment_batch"; id: string };
      payload: { batchId: string; payerUserId: string | null };
    }
  | {
      /** A donation was captured with its receipt (#106): the donor's
       * thank-you with the first receipt link, and the ledger. */
      type: "donation.captured";
      aggregate: { type: "donation"; id: string };
      payload: { donationId: string };
    }
  | {
      /** Foreign money arrived for a donation while FCRA is off (#106):
       * it is held as owed back until its refund goes out. */
      type: "donation.foreign_payment_received";
      aggregate: { type: "donation"; id: string };
      /** `refundId`: the system refund returning it. */
      payload: { donationId: string; refundId: string };
    }
  | {
      /** A refund of a donation's batch was processed (#106): the donor is
       * told, in words for a foreign payment or a donation refunded. */
      type: "donation.refunded";
      aggregate: { type: "donation"; id: string };
      payload: { donationId: string; refundId: string };
    }
  | {
      type: "recurring_donation.activated";
      aggregate: { type: "recurring_donation"; id: string };
      payload: { id: string };
    }
  | {
      type: "recurring_donation.charge_failed";
      aggregate: { type: "recurring_donation"; id: string };
      payload: { id: string };
    }
  | {
      type: "recurring_donation.cancelled";
      aggregate: { type: "recurring_donation"; id: string };
      payload: { id: string };
    }
  | {
      type: "recurring_donation.refunded";
      aggregate: { type: "recurring_donation"; id: string };
      payload: { id: string };
    }
  | {
      type: "recurring_donation.payment_refused";
      aggregate: { type: "recurring_donation"; id: string };
      payload: { id: string; refundId: string };
    }
  | {
      type: "recurring_donation.cancel_requested";
      aggregate: { type: "recurring_donation"; id: string };
      payload: { id: string };
    }
  | {
      /** A donor asked for a new receipt link by email (#106). The token
       * is minted when the email goes, never stored here. */
      type: "receipt.link_requested";
      aggregate: { type: "receipt"; id: string };
      payload: { receiptId: string };
    }
  | {
      /** A guardian invited their 13- to 17-year-old to an own login (#81). */
      type: "guardian.teen_invited";
      aggregate: { type: "guardian_invitation"; id: string };
      payload: { invitationId: string };
    }
  | {
      /**
       * A refund was approved (#80): by finance, by its kind (a
       * cancellation or a duplicate), or again on a retry. Its gateway
       * refund goes out from here (refunds.send).
       */
      type: "refund.approved";
      aggregate: { type: "refund"; id: string };
      payload: { refundId: string };
    }
  | {
      /**
       * A refund's money is back with the payer (#80). `payerUserId` started
       * the batch's payment and is told; null once their account is gone.
       */
      type: "refund.processed";
      aggregate: { type: "refund"; id: string };
      payload: { refundId: string; payerUserId: string | null };
    }
  | {
      /**
       * Finance recorded the gateway dashboard's refund of an accepted
       * receipt in another currency (#80); the payer is told.
       */
      type: "refund.dashboard_processed";
      aggregate: { type: "payment_review_case"; id: string };
      payload: { reviewCaseId: string; payerUserId: string | null };
    }
  | {
      /** The gateway gave up on a refund (#80); finance is told to act. */
      type: "refund.failed";
      aggregate: { type: "refund"; id: string };
      payload: { refundId: string };
    }
  | {
      /** A teen with no guardian yet asked one to verify and accept (#81). */
      type: "guardian.guardian_requested";
      aggregate: { type: "guardian_invitation"; id: string };
      payload: { requestId: string };
    }
  | {
      /**
       * A competition manager sent an announcement (#84): its confirmed
       * registrants are told. Ids only: who they are is planned again when
       * it goes.
       */
      type: "competition.announcement_sent";
      aggregate: { type: "announcement"; id: string };
      payload: { announcementId: string; competitionId: string };
    }
  | {
      /**
       * One person is to be told of a breach (#116). The dispatcher reads
       * their saved scope in the breach log and checks it before each send.
       */
      type: "breach.principal_notice";
      aggregate: { type: "breach"; id: string };
      payload: {
        breachId: string;
        recipientUserId: string;
      };
    }
  | {
      /**
       * Every account is to be told of a breach (#116): the fan-out job
       * plans the next `pageSize` accounts after `afterUserId` (null: from
       * the first), then saves itself again for the page after.
       */
      type: "breach.fan_out_requested";
      aggregate: { type: "breach"; id: string };
      payload: {
        breachId: string;
        afterUserId: string | null;
        pageSize: number;
      };
    }
  | {
      /** The authority is to be emailed about a breach (#116). */
      type: "breach.authority_notice";
      aggregate: { type: "breach"; id: string };
      payload: { breachId: string };
    }
  | {
      /**
       * A privacy rights request was filed (#115): the requester's receipt
       * and the grievance officers' in-app note go by route row.
       */
      type: "privacy_request.submitted";
      aggregate: { type: "privacy_request"; id: string };
      payload: { requestId: string };
    }
  | {
      /** The grievance officer refused a request; the requester is told. */
      type: "privacy_request.rejected";
      aggregate: { type: "privacy_request"; id: string };
      payload: { requestId: string };
    }
  | {
      /** A request is done (in full or in part); the requester is told. */
      type: "privacy_request.completed";
      aggregate: { type: "privacy_request"; id: string };
      payload: { requestId: string };
    }
  | {
      /** The grievance officer asked for an access request's export (#115b). */
      type: "privacy_request.export_requested";
      aggregate: { type: "privacy_request"; id: string };
      payload: { requestId: string };
    }
  | {
      /** Delayed to when an export's link stops: its object is deleted. */
      type: "privacy_request.export_expired";
      aggregate: { type: "privacy_request"; id: string };
      payload: { requestId: string };
    }
  | {
      /** The grievance officer approved an erasure's plan (#115b). */
      type: "privacy_request.erasure_approved";
      aggregate: { type: "privacy_request"; id: string };
      payload: { requestId: string };
    }
  | {
      /**
       * The daily overdue digest for one grievance officer (#115): counts
       * only, never who a request is about.
       */
      type: "privacy_request.overdue_digest";
      aggregate: { type: "privacy_overdue_digest"; id: string };
      payload: {
        officerUserId: string;
        day: string;
        overdue: number;
        assignedToYou: number;
      };
    }
  | {
      /**
       * One recipient's message of a sent campaign (#126) is due. The
       * handler checks the consent it rests on again before it goes.
       */
      type: "campaign.message_due";
      aggregate: { type: "campaign_recipient"; id: string };
      payload: { campaignId: string; recipientId: string };
    }
  | {
      /**
       * The registration's competition was cancelled (#80). Its family
       * contact (or the adult whose own it is) is told, with how its fee
       * comes back: `refund` says through the gateway, by hand, from the
       * gateway's dashboard, or none.
       */
      type: "registration.competition_cancelled";
      aggregate: { type: "registration"; id: string };
      payload: {
        registrationId: string;
        competitionId: string;
        refund: FeeReturn;
        /** It was held for a guardian (#81) when it was cancelled. */
        awaitingGuardian?: boolean;
      };
    }
  | {
      /**
       * The competition an institution registered for was cancelled
       * (#80); its coordinators and authorised person are told.
       */
      type: "institution_registration.competition_cancelled";
      aggregate: { type: "institution_registration"; id: string };
      payload: { institutionRegistrationId: string; competitionId: string };
    }
  // Volunteer applications (#123): a 14- to 17-year-old applied and their
  // guardians are asked; an application reached the community team; a
  // community manager approved it (the volunteer role is granted) or
  // declined it with a reason.
  | VolunteerApplicationEvent<"volunteer.guardian_approval_requested">
  | VolunteerApplicationEvent<"volunteer.application_submitted">
  | VolunteerApplicationEvent<"volunteer.application_approved">
  | VolunteerApplicationEvent<"volunteer.application_declined">
  // Adoption applications (#130): one was made, the coordinator moved it,
  // the applicant withdrew it, or the animal's listing closed. The
  // applicant, the listing organisation and the coordinators are told.
  | AdoptionApplicationEvent<"adoption.application_submitted">
  | AdoptionApplicationEvent<"adoption.application_under_review">
  | AdoptionApplicationEvent<"adoption.application_in_contact">
  | AdoptionApplicationEvent<"adoption.application_adopted">
  | AdoptionApplicationEvent<"adoption.application_not_matched">
  | AdoptionApplicationEvent<"adoption.application_declined">
  | AdoptionApplicationEvent<"adoption.application_withdrawn">
  | AdoptionApplicationEvent<"adoption.application_listing_closed">;

/** Something happened to a volunteer application (#123). Ids only. */
type VolunteerApplicationEvent<T extends `volunteer.${string}`> = {
  type: T;
  aggregate: { type: "volunteer_application"; id: string };
  payload: { applicationId: string };
};

/** Something happened to an adoption application (#130). Ids only. */
type AdoptionApplicationEvent<T extends `adoption.${string}`> = {
  type: T;
  aggregate: { type: "adoption_application"; id: string };
  payload: { applicationId: string };
};

export type EventType = DomainEvent["type"];

export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;

const DIRECTORY_LISTING_EVENT = z.object({
  listingId: z.uuid(),
  userId: z.uuid(),
});
const VOLUNTEER_APPLICATION = z.object({ applicationId: z.uuid() });
const SCHOOL_ROUND_OUTCOME_EVENT = z.object({
  entryId: z.uuid(),
  registrationId: z.uuid(),
  roundId: z.uuid(),
  position: z.int().min(1).nullable().optional(),
});

const ENTRY_VERIFICATION_EVENT = z.object({
  entryId: z.uuid(),
  registrationId: z.uuid(),
  institutionRegistrationId: z.uuid().nullable(),
  verificationId: z.uuid(),
});
const ADOPTION_APPLICATION = z.object({ applicationId: z.uuid() });

const INSTITUTION_DECIDED = z.object({
  institutionId: z.uuid(),
  userId: z.uuid(),
});

/**
 * Each event's payload: ids only, never an address, a name or a phone
 * number, because rows outlive the change and staff read failed ones.
 * Parsing strips any other key, so a payload built by spreading a record
 * can't carry personal data into the table.
 */
export const EVENT_PAYLOADS = {
  "consent.form_reviewed": z.object({
    formId: z.uuid(),
    uploaderUserId: z.uuid(),
  }),
  "consent.link_sent": z.object({ linkId: z.uuid() }),
  "identity.user_signed_up": z.object({ userId: z.uuid() }),
  "files.file_uploaded": z.object({ fileId: z.uuid() }),
  "consent.withdrawn": z.object({
    consentEventId: z.uuid(),
    subjectType: z.enum(CONSENT_SUBJECT_TYPES),
    subjectId: z.uuid(),
    purpose: z.enum(WITHDRAWABLE_PURPOSES),
    documentId: z.uuid(),
    competitionId: z.uuid().nullable(),
  }),
  "files.processing_requested": z.object({ fileId: z.uuid() }),
  "files.video_processing_requested": z.object({ fileId: z.uuid() }),
  "files.pdf_processing_requested": z.object({ fileId: z.uuid() }),
  "files.file_ready": z.object({ fileId: z.uuid() }),
  "files.file_processed": z.object({ fileId: z.uuid() }),
  "files.file_processing_failed": z.object({
    fileId: z.uuid(),
    code: z.enum(FILE_PROCESSING_ERROR_CODES),
  }),
  "files.file_quarantined": z.object({ fileId: z.uuid() }),
  "files.file_rejected": z.object({ fileId: z.uuid() }),
  "entry.upload_grant_issued": z.object({ fileId: z.uuid() }),
  "entry.sweep_staged_upload": z.object({ fileId: z.uuid() }),
  "entry.submitted": z.object({
    entryId: z.uuid(),
    entryFileId: z.uuid(),
    registrationId: z.uuid(),
  }),
  "entry.file_rejected": z.object({
    entryId: z.uuid(),
    entryFileId: z.uuid(),
    registrationId: z.uuid(),
    replacement: z.boolean(),
  }),
  "entry.file_failed": z.object({
    entryId: z.uuid(),
    entryFileId: z.uuid(),
    registrationId: z.uuid(),
    replacement: z.boolean(),
  }),
  "directory.listing_submitted": DIRECTORY_LISTING_EVENT,
  "directory.listing_verified": DIRECTORY_LISTING_EVENT,
  "directory.listing_rejected": DIRECTORY_LISTING_EVENT,
  "directory.listing_suspended": DIRECTORY_LISTING_EVENT,
  "directory.listing_reinstated": DIRECTORY_LISTING_EVENT,
  "institution.verified": INSTITUTION_DECIDED,
  "institution.rejected": INSTITUTION_DECIDED,
  "institution.suspended": INSTITUTION_DECIDED,
  "institution.reinstated": INSTITUTION_DECIDED,
  "competitions.key_date_scheduled": z.object({
    competitionId: z.uuid(),
    kind: z.enum(KEY_DATE_KINDS),
    dueAt: z.iso.datetime(),
  }),
  "competition.published": z.object({ competitionId: z.uuid() }),
  "competition.key_dates_changed": z.object({ competitionId: z.uuid() }),
  "competition.cancelled": z.object({ competitionId: z.uuid() }),
  "reminder.due": z.object({ reminderJobId: z.uuid() }),
  "judging.judge_invited": z.object({ invitationId: z.uuid() }),
  "institution.coordinator_invited": z.object({ invitationId: z.uuid() }),
  "contact_message.received": z.object({ messageId: z.uuid() }),
  "safeguarding.report_submitted": z.object({ reportId: z.uuid() }),
  "cms.post_scheduled": z.object({
    postId: z.uuid(),
    publishAt: z.iso.datetime(),
  }),
  "cms.post_published": z.object({ postId: z.uuid() }),
  "competition.transition_blocked": z.object({
    competitionId: z.uuid(),
    blockId: z.uuid(),
  }),
  "rubric.published": z.object({
    rubricId: z.uuid(),
    competitionId: z.uuid(),
    discipline: z.enum(DISCIPLINES),
    version: z.int().min(1),
  }),
  "competition.disciplines_changed": z.object({ competitionId: z.uuid() }),
  "registration.institution_registered": z.object({
    institutionRegistrationId: z.uuid(),
  }),
  "registration.confirmed": z.object({ registrationId: z.uuid() }),
  "competition.school_judging_started": z.object({ competitionId: z.uuid() }),
  "school_round.shortlist_finalised": z.object({
    roundId: z.uuid(),
    competitionId: z.uuid(),
    institutionRegistrationId: z.uuid(),
  }),
  "school_round.closed_on_behalf": z.object({
    roundId: z.uuid(),
    competitionId: z.uuid(),
    institutionRegistrationId: z.uuid(),
  }),
  "school_round.overdue": z.object({
    roundId: z.uuid(),
    competitionId: z.uuid(),
    institutionRegistrationId: z.uuid(),
  }),
  "competition.submissions_closed": z.object({ competitionId: z.uuid() }),
  "artwork.requested": z.object({ artworkId: z.uuid() }),
  "artwork.dispatched": z.object({ artworkId: z.uuid(), late: z.boolean() }),
  "artwork.received": z.object({
    artworkId: z.uuid(),
    dispatchRecorded: z.boolean(),
  }),
  "artwork.verified": z.object({ artworkId: z.uuid() }),
  "artwork.discrepancy_raised": z.object({ artworkId: z.uuid() }),
  "artwork.discrepancy_resolved": z.object({ artworkId: z.uuid() }),
  "artwork.exhibited": z.object({ artworkId: z.uuid() }),
  "artwork.stored": z.object({ artworkId: z.uuid() }),
  "artwork.retained": z.object({ artworkId: z.uuid() }),
  "artwork.return_requested": z.object({ artworkId: z.uuid() }),
  "artwork.returned": z.object({ artworkId: z.uuid() }),
  "results.release_due": z.object({
    competitionId: z.uuid(),
    releaseId: z.uuid(),
  }),
  "results.prize_awarded": z.object({
    competitionId: z.uuid(),
    releaseId: z.uuid(),
    entryId: z.uuid(),
    registrationId: z.uuid(),
  }),
  "results.published": z.object({
    competitionId: z.uuid(),
    releaseId: z.uuid(),
    publishedAt: z.iso.datetime(),
  }),
  "auction.lot_created": z.object({ lotId: z.uuid() }),
  "auction.lot.open": z.object({ lotId: z.uuid() }),
  "auction.lot.close": z.object({ lotId: z.uuid() }),
  "auction.lot_opened": z.object({ lotId: z.uuid() }),
  "auction.lot_closed": z.object({ lotId: z.uuid() }),
  "auction.lot_cancelled": z.object({ lotId: z.uuid() }),
  "artwork.retain_unrequested": z.object({ competitionId: z.uuid() }),
  "entry.foa_verified": ENTRY_VERIFICATION_EVENT,
  "entry.sent_back": ENTRY_VERIFICATION_EVENT,
  "entry.replacement_live": z.object({
    entryId: z.uuid(),
    entryFileId: z.uuid(),
  }),
  "entry.school_shortlisted": SCHOOL_ROUND_OUTCOME_EVENT,
  "entry.not_shortlisted": SCHOOL_ROUND_OUTCOME_EVENT,
  "registration.not_shortlisted": z.object({
    registrationId: z.uuid(),
    roundId: z.uuid(),
  }),
  "payment.batch_captured": z.object({
    batchId: z.uuid(),
    payerUserId: z.uuid().nullable(),
  }),
  "donation.captured": z.object({ donationId: z.uuid() }),
  "donation.foreign_payment_received": z.object({
    donationId: z.uuid(),
    refundId: z.uuid(),
  }),
  "donation.refunded": z.object({
    donationId: z.uuid(),
    refundId: z.uuid(),
  }),
  "recurring_donation.activated": z.object({ id: z.uuid() }),
  "recurring_donation.charge_failed": z.object({ id: z.uuid() }),
  "recurring_donation.cancelled": z.object({ id: z.uuid() }),
  "recurring_donation.refunded": z.object({ id: z.uuid() }),
  "recurring_donation.payment_refused": z.object({
    id: z.uuid(),
    refundId: z.uuid(),
  }),
  "recurring_donation.cancel_requested": z.object({ id: z.uuid() }),
  "receipt.link_requested": z.object({ receiptId: z.uuid() }),
  "guardian.teen_invited": z.object({ invitationId: z.uuid() }),
  "refund.approved": z.object({ refundId: z.uuid() }),
  "refund.processed": z.object({
    refundId: z.uuid(),
    payerUserId: z.uuid().nullable(),
  }),
  "refund.dashboard_processed": z.object({
    reviewCaseId: z.uuid(),
    payerUserId: z.uuid().nullable(),
  }),
  "refund.failed": z.object({ refundId: z.uuid() }),
  "guardian.guardian_requested": z.object({ requestId: z.uuid() }),
  "competition.announcement_sent": z.object({
    announcementId: z.uuid(),
    competitionId: z.uuid(),
  }),
  "breach.principal_notice": z.object({
    breachId: z.uuid(),
    recipientUserId: z.uuid(),
  }),
  "breach.fan_out_requested": z.object({
    breachId: z.uuid(),
    afterUserId: z.uuid().nullable(),
    pageSize: z.int().min(1).max(BREACH_FAN_OUT_PAGE_SIZE),
  }),
  "breach.authority_notice": z.object({ breachId: z.uuid() }),
  "privacy_request.submitted": z.object({ requestId: z.uuid() }),
  "privacy_request.rejected": z.object({ requestId: z.uuid() }),
  "privacy_request.completed": z.object({ requestId: z.uuid() }),
  "privacy_request.export_requested": z.object({ requestId: z.uuid() }),
  "privacy_request.export_expired": z.object({ requestId: z.uuid() }),
  "privacy_request.erasure_approved": z.object({ requestId: z.uuid() }),
  "privacy_request.overdue_digest": z.object({
    officerUserId: z.uuid(),
    day: z.iso.date(),
    overdue: z.int().min(1),
    assignedToYou: z.int().min(0),
  }),
  "campaign.message_due": z.object({
    campaignId: z.uuid(),
    recipientId: z.uuid(),
  }),
  "registration.competition_cancelled": z.object({
    registrationId: z.uuid(),
    competitionId: z.uuid(),
    refund: z.enum(FEE_RETURNS),
    awaitingGuardian: z.boolean().optional(),
  }),
  "institution_registration.competition_cancelled": z.object({
    institutionRegistrationId: z.uuid(),
    competitionId: z.uuid(),
  }),
  "volunteer.guardian_approval_requested": VOLUNTEER_APPLICATION,
  "volunteer.application_submitted": VOLUNTEER_APPLICATION,
  "volunteer.application_approved": VOLUNTEER_APPLICATION,
  "volunteer.application_declined": VOLUNTEER_APPLICATION,
  "adoption.application_submitted": ADOPTION_APPLICATION,
  "adoption.application_under_review": ADOPTION_APPLICATION,
  "adoption.application_in_contact": ADOPTION_APPLICATION,
  "adoption.application_adopted": ADOPTION_APPLICATION,
  "adoption.application_not_matched": ADOPTION_APPLICATION,
  "adoption.application_declined": ADOPTION_APPLICATION,
  "adoption.application_withdrawn": ADOPTION_APPLICATION,
  "adoption.application_listing_closed": ADOPTION_APPLICATION,
} satisfies { [T in EventType]: z.ZodType<EventOf<T>["payload"]> };

/** Validate a stored event, including withdrawals written before #82. */
export function parseStoredEventPayload(
  type: EventType,
  payload: Record<string, unknown>
) {
  const legacyWithdrawal =
    type === "consent.withdrawn" &&
    payload?.subjectType === "user" &&
    payload.purpose === "messages" &&
    !Object.hasOwn(payload, "competitionId");
  return EVENT_PAYLOADS[type].safeParse(
    legacyWithdrawal ? { ...payload, competitionId: null } : payload
  );
}

/**
 * The handlers each event is delivered to, one outbox row apiece. Every
 * event a message may follow goes to notifications.dispatch, which sends
 * whatever its route rows (message_route) name, and nothing when it has
 * none.
 */
export const SUBSCRIBERS = {
  "consent.form_reviewed": ["notifications.dispatch"],
  "identity.user_signed_up": ["notifications.dispatch"],
  "files.file_uploaded": ["files.scan_file"],
  // The modules that act on a withdrawal (gallery, social, auctions,
  // campaigns: #119, #126, #131) add their handlers here.
  "consent.withdrawn": ["notifications.dispatch", "auctions.withdraw_consent"],
  "consent.link_sent": ["consent_links.deliver"],
  // files.process_image runs in worker-media only: the media queue
  // (./queues.ts). An entry's file follows each step of its own (#85):
  // entries.apply_file_outcome reads where the file stands, so the order
  // these arrive in doesn't matter.
  "files.processing_requested": [
    "files.process_image",
    "entries.apply_file_outcome",
  ],
  // files.process_video runs in worker-media only, like process_image (#86).
  "files.video_processing_requested": [
    "files.process_video",
    "entries.apply_file_outcome",
  ],
  // Essay PDF rasterisation also runs only in worker-media (#96).
  "files.pdf_processing_requested": [
    "files.process_pdf",
    "entries.apply_file_outcome",
  ],
  // A file that needs no derivatives is ready once its scan passes (#86).
  "files.file_ready": ["entries.apply_file_outcome"],
  // A post image's public copies follow its derivatives (#112).
  "files.file_processed": [
    "cms.publish_post_image",
    "entries.apply_file_outcome",
  ],
  "files.file_processing_failed": ["entries.apply_file_outcome"],
  "files.file_quarantined": ["entries.apply_file_outcome"],
  "files.file_rejected": ["entries.apply_file_outcome"],
  "entry.upload_grant_issued": ["entries.expire_upload_grant"],
  "entry.sweep_staged_upload": ["entries.sweep_staged_upload"],
  // The participant's, or their guardian's, messages go by route row (#85).
  // A school's student's family contact isn't a user: their receipt goes
  // by its own handler (#87).
  // An individual entry submitted after submissions closed goes on to FOA
  // at once (#92).
  "entry.submitted": [
    "notifications.dispatch",
    "entries.send_family_receipt",
    "verification.forward_late_entry",
  ],
  "entry.file_rejected": ["notifications.dispatch"],
  "entry.file_failed": ["notifications.dispatch"],
  // The owner hears FOA's decisions by route row (#127). No route names
  // a submission yet: staff find it in the review queue.
  "directory.listing_submitted": ["notifications.dispatch"],
  "directory.listing_verified": ["notifications.dispatch"],
  "directory.listing_rejected": ["notifications.dispatch"],
  "directory.listing_suspended": ["notifications.dispatch"],
  "directory.listing_reinstated": ["notifications.dispatch"],
  "institution.verified": ["notifications.dispatch"],
  "institution.rejected": ["notifications.dispatch"],
  "institution.suspended": ["notifications.dispatch"],
  "institution.reinstated": ["notifications.dispatch"],
  // The shortlist deadline also makes unfinished school rounds overdue (#90).
  "competitions.key_date_scheduled": [
    "competitions.advance_status",
    "school_round.mark_overdue",
  ],
  // Each keeps the competition's reminders in step with it (#84).
  "competition.published": ["reminders.schedule"],
  "competition.key_dates_changed": ["reminders.schedule"],
  "competition.cancelled": ["reminders.schedule"],
  // One handler reminds whoever owes the deadline when it runs (#84).
  "reminder.due": ["reminders.run"],
  // An invitee has no account yet, so no route row can name them: the
  // invitation goes to the invited address itself (#74).
  "judging.judge_invited": ["judging.send_invitation"],
  "institution.coordinator_invited": [
    "institutions.send_coordinator_invitation",
  ],
  // The team's in-app note goes by route row; the sender, who has no
  // account, gets the acknowledgement from the contact module.
  "contact_message.received": [
    "notifications.dispatch",
    "contact.send_acknowledgement",
  ],
  // The safeguarding leads' alert (#116).
  "safeguarding.report_submitted": ["notifications.dispatch"],
  "cms.post_scheduled": ["cms.publish_scheduled_post"],
  // No route sends anything for it yet; a "new story" message can follow it.
  "cms.post_published": ["notifications.dispatch"],
  "competition.transition_blocked": ["notifications.dispatch"],
  // Each guard's retryOn events (modules/competitions/transition-guards.ts).
  "rubric.published": ["competitions.retry_blocked_moves"],
  "competition.disciplines_changed": ["competitions.retry_blocked_moves"],
  // The competition's school rounds open (#89).
  "competition.school_judging_started": ["school_round.open_rounds"],
  // Individual entries go on to FOA when submissions close (#92).
  "competition.submissions_closed": ["verification.forward_individual_entries"],
  // The participant, guardian or coordinators hear by route row (#92).
  "artwork.requested": ["notifications.dispatch", "reminders.schedule_artwork"],
  "artwork.dispatched": ["reminders.schedule_artwork"],
  "artwork.received": ["notifications.dispatch", "reminders.schedule_artwork"],
  "artwork.verified": ["notifications.dispatch"],
  "artwork.discrepancy_raised": ["notifications.dispatch"],
  "artwork.discrepancy_resolved": ["notifications.dispatch"],
  "artwork.exhibited": ["notifications.dispatch"],
  "artwork.stored": ["notifications.dispatch"],
  "artwork.retained": ["notifications.dispatch"],
  "artwork.return_requested": ["notifications.dispatch"],
  "artwork.returned": ["notifications.dispatch"],
  "results.release_due": ["results.publish"],
  "results.prize_awarded": [
    "notifications.dispatch",
    "results.send_family_prize",
  ],
  "results.published": [
    "artwork.open_results_window",
    "community.record_results",
  ],
  "artwork.retain_unrequested": ["artwork.retain_unrequested"],
  "auction.lot_created": ["notifications.dispatch"],
  "auction.lot.open": ["auctions.open_lot"],
  "auction.lot.close": ["auctions.close_lot"],
  "auction.lot_opened": ["notifications.dispatch"],
  "auction.lot_closed": ["auctions.settle_closed"],
  "auction.lot_cancelled": ["notifications.dispatch"],

  "entry.foa_verified": ["notifications.dispatch"],
  "entry.sent_back": ["notifications.dispatch"],
  // A resubmitted file went live: the entry returns to FOA (#92).
  "entry.replacement_live": ["verification.return_resubmission"],
  // Each family is told the outcome, one event per entry (#89).
  // A finished round also retries the refused move to FOA judging (#90).
  "school_round.shortlist_finalised": [
    "school_round.queue_family_outcomes",
    "competitions.retry_blocked_moves",
  ],
  "school_round.closed_on_behalf": [
    "school_round.queue_family_outcomes",
    "competitions.retry_blocked_moves",
  ],
  // Its coordinators hear by route row (`institution_coordinators`, #90).
  "school_round.overdue": ["notifications.dispatch"],
  // The family contact isn't a user: the message goes by the school
  // round's own handler, by its `family_contact` route (#89).
  "entry.school_shortlisted": ["school_round.send_family_outcome"],
  "entry.not_shortlisted": ["school_round.send_family_outcome"],
  "registration.not_shortlisted": ["school_round.send_family_outcome"],
  // The principal is a contact on the institution, not a user, so no
  // route row can name them: the message goes by its own handler (#75).
  "registration.institution_registered": ["registration.notify_principal"],
  // The family contact isn't a user, so no route row can name them: the
  // confirmation goes by its own handler (#77). An adult's own goes by
  // route row (#78).
  "registration.confirmed": [
    "registration.send_confirmation",
    "notifications.dispatch",
  ],
  // The payer's receipt goes by route row (#77).
  "payment.batch_captured": ["notifications.dispatch", "ledger.post_capture"],
  // A guest donor has no account, so no route row can name them: the
  // donations module emails the address they gave, with its route's
  // template, and minting each receipt link as the message goes (#106).
  "donation.captured": ["donations.send_thank_you", "ledger.post_donation"],
  "donation.foreign_payment_received": ["ledger.post_foreign_donation"],
  "donation.refunded": ["donations.send_refund_notice"],
  "recurring_donation.activated": ["recurring_donations.send_notice"],
  "recurring_donation.charge_failed": ["recurring_donations.send_notice"],
  "recurring_donation.cancelled": ["recurring_donations.send_notice"],
  "recurring_donation.refunded": ["recurring_donations.send_notice"],
  "recurring_donation.payment_refused": ["ledger.post_foreign_donation"],
  "recurring_donation.cancel_requested": ["recurring_donations.cancel"],
  "receipt.link_requested": ["donations.send_receipt_link"],
  // The teen may have no account yet, so no route row can name them: the
  // invitation goes to the invited address by its own handler (#81).
  "guardian.teen_invited": ["guardians.send_teen_invitation"],
  // The one funnel to the gateway (#80): approval, system refunds, retries.
  "refund.approved": ["refunds.send"],
  // The payer's notice and finance's alert go by route row (#80).
  "refund.processed": ["notifications.dispatch", "ledger.post_refund"],
  "refund.dashboard_processed": ["notifications.dispatch"],
  "refund.failed": ["notifications.dispatch"],
  // The guardian a teen names may have no account yet: the request goes to
  // the address the teen gave by its own handler (#81).
  "guardian.guardian_requested": ["guardians.send_guardian_request"],
  // One handler reaches accounts and contact details from one roster (#84).
  "competition.announcement_sent": ["announcements.fan_out"],
  // A breach notice goes by route row (audience `breach_recipient`, #116).
  "breach.principal_notice": ["notifications.dispatch"],
  // Plans one page of a breach's notices to every account, in the worker.
  "breach.fan_out_requested": ["breaches.fan_out"],
  // The authority is an address, not a user, so no route row can name it:
  // the email goes by its own handler, with its route's template (#116).
  "breach.authority_notice": ["breaches.send_authority_notice"],
  // The requester's receipt and outcome, and the grievance officers'
  // notes, go by route row (#115).
  "privacy_request.submitted": ["notifications.dispatch"],
  "privacy_request.rejected": ["notifications.dispatch"],
  "privacy_request.completed": ["notifications.dispatch"],
  "privacy_request.overdue_digest": ["notifications.dispatch"],
  // The export and erasure jobs, in the worker (#115b). Each is safe to
  // repeat: a finished export or erasure is left alone.
  "privacy_request.export_requested": ["privacy.build_export"],
  "privacy_request.export_expired": ["privacy.expire_export"],
  "privacy_request.erasure_approved": ["privacy.execute_erasure"],
  // The campaigns module plans its own channels on the consent each
  // message rests on, with its route's template (#126).
  "campaign.message_due": ["campaigns.deliver_message"],
  // The family contact isn't a user: their message goes by its own
  // handler, as the confirmation's does; an adult's own and a minor's
  // guardians' go by route row (#80).
  "registration.competition_cancelled": [
    "registration.send_cancellation",
    "notifications.dispatch",
  ],
  // The coordinators' notice goes by route row (#80).
  "institution_registration.competition_cancelled": ["notifications.dispatch"],
  // The applicant, their guardians and the community team are told by
  // route row (#123).
  "volunteer.guardian_approval_requested": ["notifications.dispatch"],
  "volunteer.application_submitted": ["notifications.dispatch"],
  "volunteer.application_approved": ["notifications.dispatch"],
  "volunteer.application_declined": ["notifications.dispatch"],
  // The applicant, the listing organisation's representatives and the
  // coordinators are told by route row (#130).
  "adoption.application_submitted": ["notifications.dispatch"],
  "adoption.application_under_review": ["notifications.dispatch"],
  "adoption.application_in_contact": ["notifications.dispatch"],
  "adoption.application_adopted": ["notifications.dispatch"],
  "adoption.application_not_matched": ["notifications.dispatch"],
  "adoption.application_declined": ["notifications.dispatch"],
  "adoption.application_withdrawn": ["notifications.dispatch"],
  "adoption.application_listing_closed": ["notifications.dispatch"],
} as const satisfies { [T in EventType]: readonly string[] };

export type HandlerName = (typeof SUBSCRIBERS)[EventType][number];
