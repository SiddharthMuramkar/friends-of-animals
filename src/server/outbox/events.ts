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

export type DomainEvent =
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
      payload: { donationId: string; gatewayPaymentId: string };
    }
  | {
      /** A refund of a donation's batch was processed (#106): the donor is
       * told, in words for a foreign payment or a donation refunded. */
      type: "donation.refunded";
      aggregate: { type: "donation"; id: string };
      payload: { donationId: string; refundId: string };
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
    };

export type EventType = DomainEvent["type"];

export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;

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
  "institution.verified": INSTITUTION_DECIDED,
  "institution.rejected": INSTITUTION_DECIDED,
  "institution.suspended": INSTITUTION_DECIDED,
  "institution.reinstated": INSTITUTION_DECIDED,
  "competitions.key_date_scheduled": z.object({
    competitionId: z.uuid(),
    kind: z.enum(KEY_DATE_KINDS),
    dueAt: z.iso.datetime(),
  }),
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
  "payment.batch_captured": z.object({
    batchId: z.uuid(),
    payerUserId: z.uuid().nullable(),
  }),
  "donation.captured": z.object({ donationId: z.uuid() }),
  "donation.foreign_payment_received": z.object({
    donationId: z.uuid(),
    gatewayPaymentId: z.string().min(1).max(100),
  }),
  "donation.refunded": z.object({
    donationId: z.uuid(),
    refundId: z.uuid(),
  }),
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
  "consent.withdrawn": ["notifications.dispatch"],
  "consent.link_sent": ["consent_links.deliver"],
  // files.process_image runs in worker-media only: the media queue
  // (./queues.ts). An entry's file follows each step of its own (#85):
  // entries.apply_file_outcome reads where the file stands, so the order
  // these arrive in doesn't matter.
  "files.processing_requested": [
    "files.process_image",
    "entries.apply_file_outcome",
  ],
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
  "entry.submitted": ["notifications.dispatch"],
  "entry.file_rejected": ["notifications.dispatch"],
  "entry.file_failed": ["notifications.dispatch"],
  "institution.verified": ["notifications.dispatch"],
  "institution.rejected": ["notifications.dispatch"],
  "institution.suspended": ["notifications.dispatch"],
  "institution.reinstated": ["notifications.dispatch"],
  "competitions.key_date_scheduled": ["competitions.advance_status"],
  // An invitee has no account yet, so no route row can name them: the
  // invitation goes to the invited address itself (#74).
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
  // The family contact isn't a user: their message goes by its own
  // handler, as the confirmation's does; an adult's own and a minor's
  // guardians' go by route row (#80).
  "registration.competition_cancelled": [
    "registration.send_cancellation",
    "notifications.dispatch",
  ],
  // The coordinators' notice goes by route row (#80).
  "institution_registration.competition_cancelled": ["notifications.dispatch"],
} as const satisfies { [T in EventType]: readonly string[] };

export type HandlerName = (typeof SUBSCRIBERS)[EventType][number];
