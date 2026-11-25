import { withdrawSocialExportConsent } from "../modules/social-export/withdrawal";
import type { CdnPurger } from "../ports/cdn-purger";
import {
  runGalleryPurge,
  withdrawGalleryConsent,
} from "../modules/gallery/purge";
import { renderStamp } from "../modules/stamping";
import { sendSaleFamilyLetter } from "../modules/auctions/messages";
import { expireAuctionOffer } from "../modules/auctions/offers";
import { sendRecurringCancel } from "../modules/donations/recurring/cancel";
// What each handler named in ./events.ts SUBSCRIBERS does with a delivery.
// A handler may run more than once for one delivery (a worker that dies
// after the handler's work but before settling runs it again once the
// lease runs out), so make it safe to repeat, or pass `delivery.id` to a
// provider that takes an idempotency key.
//
// What a handler throws is kept in outbox.last_error for staff to read
// (./failure.ts hides addresses, numbers, URL tokens and credentials it can
// spot). Never put personal data (a name, an address), a code or a secret
// in a thrown message: name the record by its id instead.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import { recordPublishedEngagement } from "../modules/community/results";
import { issueCertificates } from "../modules/certificates/issue";
import {
  buildInstitutionCertificateArchive,
  expireInstitutionCertificateArchive,
} from "../modules/certificates/archive";
import { sendFamilyReissue } from "../modules/certificates/messages";
import { renderCertificate } from "../modules/certificates/render";
import type { PdfRenderer } from "../ports/pdf";
import { publishResultsRelease } from "../modules/results/releases";
import { sendFamilyPrize } from "../modules/results/messages";
import {
  runOpenLot,
  runCloseLot,
  runSettleClosedLot,
  withdrawAuctionConsent,
} from "../modules/auctions/lifecycle";
import { retainUnrequested } from "../modules/physical-artwork/custody";
import { openArtworkResultsWindow } from "../modules/physical-artwork/results-window";
import type { Deps } from "../deps";
import type { BlindIndex } from "../crypto/blind-index";
import type { FieldCipher } from "../crypto/field-cipher";
import type { AppDb } from "../db/app-db";
import { sendJudgeInvitation } from "../modules/judging/invitation-message";
import { sendCoordinatorInvitation } from "../modules/institutions/coordinators/invitation-message";
import type { AppEnv } from "../../lib/site";
import { deliverConsentLink } from "../modules/consent-links/delivery";
import { dispatchEvent } from "../modules/notifications/dispatch";
import { uploadKeyFor } from "../modules/files/domain/storage-key";
import { processImageAsset } from "../modules/files/process-image";
import { processPdfAsset } from "../modules/files/process-pdf";
import { processVideoAsset } from "../modules/files/process-video";
import { scanUploadedFile } from "../modules/files/scan-handler";
import { sendContactAcknowledgement } from "../modules/contact/acknowledge";
import { publishPostImage } from "../modules/cms/posts/images";
import { publishScheduledPost } from "../modules/cms/posts/publishing";
import {
  retryBlockedMoves,
  runStatusJob,
} from "../modules/competitions/advance-status";
import { notifyPrincipal } from "../modules/registration/principal-message";
import { sendRegistrationConfirmation } from "../modules/registration/confirmation-message";
import { sendGuardianRequest } from "../modules/guardians/guardian-request-message";
import { sendTeenInvitation } from "../modules/guardians/teen-invitation-message";
import { sendApprovedRefund } from "../modules/payments/refunds/sync-refund";
import { fanOutAnnouncement } from "../modules/announcements/fan-out";
import { sendCancellationToFamily } from "../modules/competitions/cancellation-message";
import {
  ledgerWorker,
  postDonation,
  postForeignDonation,
  postPaymentCapture,
  postRefund,
} from "../modules/ledger/consumers";
import {
  sendReceiptLink,
  sendRefundNotice,
  sendThankYou,
  sendRecurringNotice,
} from "../modules/donations/messages";
import { applyEntryFileOutcome } from "../modules/entries/apply-file-outcome";
import { sendEntryReceiptToFamily } from "../modules/entries/family-receipt";
import { expireUploadGrant } from "../modules/entries/upload-grants";
import { fanOutBreachNotices } from "../modules/breaches/fan-out";
import { sendAuthorityNotice } from "../modules/breaches/authority-message";
import {
  runBuildExport,
  runExpireExport,
} from "../modules/privacy/requests/subject-data/export";
import { runExecuteErasure } from "../modules/privacy/requests/subject-data/erasure";
import { refillPlaces } from "../modules/events/registrations";
import { settleEndedEvent } from "../modules/events/end";
import { runReminderJob } from "../modules/reminders/run-reminder";
import { scheduleReminders } from "../modules/reminders/schedule-reminders";
import { deliverSurveyInvitation } from "../modules/surveys/deliver";
import { deliverCampaignMessage } from "../modules/campaigns/deliver";
import { runRoundDeadlineJob } from "../modules/school-round/overdue";
import {
  forwardOnSubmissionsClosed,
  forwardLateEntry,
} from "../modules/verification/forward-individual-entries";
import { returnResubmission } from "../modules/verification/return-resubmission";
import { openSchoolRounds } from "../modules/school-round/open-school-rounds";
import {
  queueFamilyOutcomes,
  sendFamilyOutcome,
} from "../modules/school-round/family-outcomes";
import type { Clock } from "../ports/clock";
import type { EmailSender } from "../ports/email";
import type { MalwareScanner } from "../ports/malware-scanner";
import type { MediaProcessor } from "../ports/media";
import type { PaymentGateway } from "../ports/payment-gateway";
import type { Settings } from "../ports/settings";
import type { SmsSender } from "../ports/sms";
import type { ObjectStorage } from "../ports/storage";
import type { EventOf, EventType, HandlerName, SUBSCRIBERS } from "./events";

/** What the relay and handlers run against; the worker can supply it. */
export type OutboxDeps = {
  cdn?: CdnPurger;
  appEnv: AppEnv;
  db: AppDb;
  clock: Clock;
  email: EmailSender;
  sms: SmsSender;
  /** Runtime settings, such as whether messages may go by SMS. */
  settings: Settings;
  /**
   * Reads a recipient's stored phone number, and an invitation's address
   * and link (#74).
   */
  cipher: FieldCipher;
  /** Keys an external announcement destination for its delivery claim (#84). */
  blindIndex: BlindIndex;
  /**
   * The site's base URL, for links in messages. A worker started without
   * APP_URL has none, and a message that needs a link fails until it does.
   */
  auth: { baseUrl?: string | undefined };
  storage: ObjectStorage;
  /** Null prefix for a legacy preview database with no storage namespace. */
  files: { bucket: string; keyPrefix: string | null };
  scanner: MalwareScanner;
  /** Used only by the media queue's handlers, in worker-media. */
  media: MediaProcessor;
  pdf?: PdfRenderer;
  /** Sends approved refunds and reads them back (#80). */
  payments: PaymentGateway;
} & Pick<Deps, "appEnv">;

/** The event a handler listens to, from SUBSCRIBERS. */
type EventFor<H extends HandlerName> = {
  [T in EventType]: H extends (typeof SUBSCRIBERS)[T][number] ? T : never;
}[EventType];

/** One delivery, as its handler receives it: one per event type in `T`. */
export type Delivery<T extends EventType = EventType> = T extends EventType
  ? {
      /** The outbox row's id: the delivery's idempotency key. */
      id: string;
      eventId: string;
      eventType: T;
      occurredAt: Date;
      /** 1 on the first try. */
      attempt: number;
      payload: EventOf<T>["payload"];
    }
  : never;

type Handlers = {
  [H in HandlerName]: (
    deps: OutboxDeps,
    delivery: Delivery<EventFor<H>>
  ) => Promise<void>;
};

export const HANDLERS: Handlers = {
  "community.record_results": async (deps, { payload }) => {
    await recordPublishedEngagement(
      { ...deps, actor: { kind: "system", process: "worker" } },
      payload
    );
  },
  "certificates.issue": async (deps, { payload }) => {
    await issueCertificates(
      { ...deps, actor: { kind: "system", process: "worker" } },
      payload
    );
  },
  "gallery.withdraw_consent": withdrawGalleryConsent,
  "social_export.withdraw_consent": withdrawSocialExportConsent,
  "gallery.purge": (deps, { payload }) =>
    runGalleryPurge(deps, payload.purgeId),
  "certificates.build_archive": (deps, delivery) =>
    buildInstitutionCertificateArchive(
      { ...deps, actor: { kind: "system", process: "worker" } },
      delivery.payload
    ),
  "certificates.expire_archive": (deps, delivery) =>
    expireInstitutionCertificateArchive(
      { ...deps, actor: { kind: "system", process: "worker" } },
      delivery.payload
    ),
  "certificates.send_family_reissue": sendFamilyReissue,
  "stamping.render": (deps, { payload }) => renderStamp(deps, payload),
  "certificate.render": (deps, { payload }) =>
    renderCertificate(
      { ...deps, actor: { kind: "system", process: "worker" } },
      payload
    ),
  "results.publish": async (deps, delivery) => {
    await publishResultsRelease(
      { ...deps, actor: { kind: "system", process: "worker" } },
      delivery.payload
    );
  },
  "results.send_family_prize": sendFamilyPrize,
  "verification.forward_individual_entries": (deps, { payload }) =>
    forwardOnSubmissionsClosed(deps, payload),
  "verification.forward_late_entry": (deps, { payload }) =>
    forwardLateEntry(deps, payload),
  "verification.return_resubmission": (deps, { payload }) =>
    returnResubmission(deps, payload),
  "ledger.post_capture": async (deps, { payload }) => {
    await postPaymentCapture({ ...deps, actor: ledgerWorker }, payload);
  },
  "ledger.post_refund": async (deps, { payload }) => {
    await postRefund({ ...deps, actor: ledgerWorker }, payload);
  },
  // Donations (#106): their postings, and the donor's messages.
  "ledger.post_donation": async (deps, { payload }) => {
    await postDonation({ ...deps, actor: ledgerWorker }, payload);
  },
  "ledger.post_foreign_donation": async (deps, { payload }) => {
    await postForeignDonation({ ...deps, actor: ledgerWorker }, payload);
  },
  "donations.send_thank_you": sendThankYou,
  "recurring_donations.cancel": async (deps, { payload }) => {
    await sendRecurringCancel(
      { ...deps, actor: { kind: "system", process: "worker" } },
      payload.id
    );
  },
  "recurring_donations.send_notice": sendRecurringNotice,
  "donations.send_receipt_link": sendReceiptLink,
  "donations.send_refund_notice": sendRefundNotice,
  // Sends the messages the event's route rows name (#69).
  "notifications.dispatch": dispatchEvent,
  "consent_links.deliver": (deps, { payload }) =>
    deliverConsentLink(deps, payload),
  "files.scan_file": (deps, { payload }) => scanUploadedFile(deps, payload),
  "files.process_image": (deps, delivery) => processImageAsset(deps, delivery),
  "files.process_video": (deps, delivery) => processVideoAsset(deps, delivery),
  "files.process_pdf": (deps, delivery) => processPdfAsset(deps, delivery),
  "competitions.advance_status": (deps, { payload }) =>
    runStatusJob(deps, payload),
  "judging.send_invitation": (deps, { payload }) =>
    sendJudgeInvitation(deps, payload),
  "institutions.send_coordinator_invitation": (deps, { payload }) =>
    sendCoordinatorInvitation(deps, payload),
  // Emails a contact message's sender their reference (#113).
  "contact.send_acknowledgement": sendContactAcknowledgement,
  "cms.publish_post_image": (deps, { payload }) =>
    publishPostImage(deps, payload),
  "cms.publish_scheduled_post": (deps, { payload }) =>
    publishScheduledPost(deps, payload),
  // Tries a refused move again after an event its guard names (#88).
  "competitions.retry_blocked_moves": (deps, { payload }) =>
    retryBlockedMoves(deps, payload),
  "registration.notify_principal": (deps, { payload }) =>
    notifyPrincipal(deps, payload),
  // Emails a confirmed registration's family its number (#77).
  "registration.send_confirmation": sendRegistrationConfirmation,
  // Emails a guardian's invitation to their teen's own login (#81).
  "guardians.send_teen_invitation": (deps, { payload }) =>
    sendTeenInvitation(deps, payload),
  // Sends an approved refund to the gateway, or adopts the one it holds
  // (#80). Safe to repeat: the gateway's refund is found by its notes.
  "refunds.send": (deps, { payload }) => sendApprovedRefund(deps, payload),
  // Emails a teen's request to the guardian they named (#81).
  "guardians.send_guardian_request": (deps, { payload }) =>
    sendGuardianRequest(deps, payload),
  // Sends a competition's announcement to its registrants (#84).
  "announcements.fan_out": fanOutAnnouncement,
  // Emails each family that its competition was cancelled (#80).
  "registration.send_cancellation": sendCancellationToFamily,
  // Brings an entry's file up to date with its scan and derivatives (#85).
  "entries.apply_file_outcome": (deps, { payload }) =>
    applyEntryFileOutcome(deps, payload),
  // Emails a school's student's family that their entry arrived (#87).
  "entries.send_family_receipt": sendEntryReceiptToFamily,
  "entries.expire_upload_grant": (deps, { payload }) =>
    expireUploadGrant(deps, payload),
  "entries.sweep_staged_upload": (
    { storage, files },
    { payload: { fileId } }
  ) => {
    if (files.keyPrefix === null) {
      throw new Error("The database has no entry staging prefix");
    }
    return storage.delete({
      bucket: files.bucket,
      key: uploadKeyFor({ prefix: files.keyPrefix, fileId }),
    });
  },
  // Plans one page of a breach's notices to every account, and saves the
  // next page (#116). Safe to repeat: a notice already queued is skipped.
  "breaches.fan_out": (deps, { payload }) => fanOutBreachNotices(deps, payload),
  // Emails the authority about a breach, once (#116).
  "breaches.send_authority_notice": (deps, { payload }) =>
    sendAuthorityNotice(deps, payload),
  // Builds and stores an access request's data export (#115b). Safe to
  // repeat: a request no longer waiting for its export is left alone.
  "privacy.build_export": (deps, { payload }) => runBuildExport(deps, payload),
  // Deletes an export once its link has expired (#115b).
  "privacy.expire_export": (deps, { payload }) =>
    runExpireExport(deps, payload),
  // Carries out an approved erasure (#115b). Safe to repeat: a closed
  // request is left alone, and a changed plan is refused.
  "privacy.execute_erasure": (deps, { payload }) =>
    runExecuteErasure(deps, payload),
  // Brings a competition's reminders in step after it is published, its
  // key dates change or it is cancelled (#84). Safe to repeat.
  "reminders.schedule": async (deps, { payload }) => {
    const result = await scheduleReminders(
      { ...deps, actor: { kind: "system", process: "worker" } },
      { subjectType: "competition", subjectId: payload.competitionId }
    );
    if (!result.ok) {
      throw new Error(
        `Reminders for competition ${payload.competitionId} not scheduled: ${result.fields.join(", ")}`
      );
    }
  },
  "auctions.open_lot": (deps, { payload }) =>
    runOpenLot(deps, payload).then(() => undefined),
  "auctions.close_lot": (deps, { payload }) =>
    runCloseLot(deps, payload).then(() => undefined),
  "auctions.send_family_letter": sendSaleFamilyLetter,
  "auctions.expire_offer": (deps, { payload }) =>
    expireAuctionOffer(
      { ...deps, actor: { kind: "system", process: "worker" } },
      payload
    ).then(() => undefined),
  "auctions.settle_closed": (deps, { payload }) =>
    runSettleClosedLot(deps, payload).then(() => undefined),
  "auctions.withdraw_consent": (deps, { payload }) =>
    withdrawAuctionConsent(deps, payload),
  "artwork.open_results_window": (deps, { payload }) =>
    openArtworkResultsWindow(deps, payload),
  "artwork.retain_unrequested": (deps, { payload }) =>
    retainUnrequested(deps, payload),
  "reminders.schedule_event": async (deps, { payload }) => {
    await scheduleReminders(
      { ...deps, actor: { kind: "system", process: "worker" } },
      { subjectType: "event", subjectId: payload.eventId }
    );
  },
  "events.refill_places": async (deps, { payload }) =>
    refillPlaces(
      { ...deps, actor: { kind: "system", process: "worker" } },
      payload.eventId
    ),
  "events.settle": async (deps, { payload }) => {
    await settleEndedEvent(
      { ...deps, actor: { kind: "system", process: "worker" } },
      payload
    );
  },
  "reminders.schedule_artwork": async (deps, { payload }) => {
    await scheduleReminders(
      { ...deps, actor: { kind: "system", process: "worker" } },
      { subjectType: "physical_artwork", subjectId: payload.artworkId }
    );
  },
  // Reminds whoever owes the deadline now (#84). Safe to repeat: each
  // message is claimed under the reminder's id.
  "reminders.run": (deps, { payload }) => runReminderJob(deps, payload),
  // One recipient's campaign message, on the consent it rests on (#126).
  "surveys.deliver_invitation": deliverSurveyInvitation,
  "campaigns.deliver_message": deliverCampaignMessage,
  // Opens the competition's school rounds (#89). Safe to repeat.
  "school_round.open_rounds": async (deps, { payload }) => {
    await openSchoolRounds(deps, payload);
    // A refused move to FOA judging counted these rounds as missing (#90).
    await retryBlockedMoves(deps, payload);
  },
  // Queues one outcome message per entry of a finalised round (#89), once.
  "school_round.queue_family_outcomes": (deps, { payload }) =>
    queueFamilyOutcomes(deps, payload),
  // Emails one entry's family its school round outcome (#89).
  "school_round.send_family_outcome": sendFamilyOutcome,
  // At the shortlist deadline, makes unfinished school rounds overdue
  // (#90). Safe to repeat: only open rounds move.
  "school_round.mark_overdue": (deps, { payload }) =>
    runRoundDeadlineJob(deps, payload),
};

/** Whether this code has a handler by that name. */
export function isKnownHandler(name: string): name is HandlerName {
  return Object.hasOwn(HANDLERS, name);
}
