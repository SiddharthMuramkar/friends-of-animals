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

import type { Deps } from "../deps";
import type { FieldCipher } from "../crypto/field-cipher";
import type { AppDb } from "../db/app-db";
import { sendCoordinatorInvitation } from "../modules/institutions/coordinators/invitation-message";
import type { AppEnv } from "../../lib/site";
import { deliverConsentLink } from "../modules/consent-links/delivery";
import { dispatchEvent } from "../modules/notifications/dispatch";
import { uploadKeyFor } from "../modules/files/domain/storage-key";
import { processImageAsset } from "../modules/files/process-image";
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
import {
  ledgerWorker,
  postPaymentCapture,
  postRefund,
} from "../modules/ledger/consumers";
import { applyEntryFileOutcome } from "../modules/entries/apply-file-outcome";
import { expireUploadGrant } from "../modules/entries/upload-grants";
import { fanOutBreachNotices } from "../modules/breaches/fan-out";
import { sendAuthorityNotice } from "../modules/breaches/authority-message";
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
  "ledger.post_capture": async (deps, { payload }) => {
    await postPaymentCapture({ ...deps, actor: ledgerWorker }, payload);
  },
  "ledger.post_refund": async (deps, { payload }) => {
    await postRefund({ ...deps, actor: ledgerWorker }, payload);
  },
  // Sends the messages the event's route rows name (#69).
  "notifications.dispatch": dispatchEvent,
  "consent_links.deliver": (deps, { payload }) =>
    deliverConsentLink(deps, payload),
  "files.scan_file": (deps, { payload }) => scanUploadedFile(deps, payload),
  "files.process_image": (deps, delivery) => processImageAsset(deps, delivery),
  "competitions.advance_status": (deps, { payload }) =>
    runStatusJob(deps, payload),
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
  // Brings an entry's file up to date with its scan and derivatives (#85).
  "entries.apply_file_outcome": (deps, { payload }) =>
    applyEntryFileOutcome(deps, payload),
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
};

/** Whether this code has a handler by that name. */
export function isKnownHandler(name: string): name is HandlerName {
  return Object.hasOwn(HANDLERS, name);
}
