// The domain events use cases emit, and which handlers each one goes to.
// Adding an event: add it to `DomainEvent`, give it a payload schema in
// EVENT_PAYLOADS, and list its handlers in SUBSCRIBERS (each name then
// needs an implementation in ./handlers.ts).
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import { z } from "zod";

import {
  CONSENT_SUBJECT_TYPES,
  GIVABLE_PURPOSES,
  type ConsentSubjectType,
  type GivablePurpose,
} from "../modules/consent/domain/purposes";
import { FILE_PROCESSING_ERROR_CODES } from "../ports/media";

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
      /** Someone withdrew consent (#64); later modules stop what it allowed. */
      type: "consent.withdrawn";
      aggregate: { type: "consent_event"; id: string };
      payload: {
        consentEventId: string;
        subjectType: ConsentSubjectType;
        subjectId: string;
        purpose: GivablePurpose;
        documentId: string;
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
  /** Verified for the first time: it has its Institution ID. */
  | InstitutionDecided<"institution.verified">
  /** Its registration wasn't accepted; the person may register again. */
  | InstitutionDecided<"institution.rejected">
  /** Suspended for now; it keeps its Institution ID and its admin. */
  | InstitutionDecided<"institution.suspended">
  /** Verified again after a suspension, with the Institution ID it had. */
  | InstitutionDecided<"institution.reinstated">;

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
  "identity.user_signed_up": z.object({ userId: z.uuid() }),
  "files.file_uploaded": z.object({ fileId: z.uuid() }),
  "consent.withdrawn": z.object({
    consentEventId: z.uuid(),
    subjectType: z.enum(CONSENT_SUBJECT_TYPES),
    subjectId: z.uuid(),
    purpose: z.enum(GIVABLE_PURPOSES),
    documentId: z.uuid(),
  }),
  "files.processing_requested": z.object({ fileId: z.uuid() }),
  "files.file_processed": z.object({ fileId: z.uuid() }),
  "files.file_processing_failed": z.object({
    fileId: z.uuid(),
    code: z.enum(FILE_PROCESSING_ERROR_CODES),
  }),
  "institution.verified": INSTITUTION_DECIDED,
  "institution.rejected": INSTITUTION_DECIDED,
  "institution.suspended": INSTITUTION_DECIDED,
  "institution.reinstated": INSTITUTION_DECIDED,
} satisfies { [T in EventType]: z.ZodType<EventOf<T>["payload"]> };

/**
 * The handlers each event is delivered to, one outbox row apiece. Every
 * event a message may follow goes to notifications.dispatch, which sends
 * whatever its route rows (message_route) name, and nothing when it has
 * none.
 */
export const SUBSCRIBERS = {
  "identity.user_signed_up": ["notifications.dispatch"],
  "files.file_uploaded": ["files.scan_file"],
  // The modules that act on a withdrawal (gallery, social, auctions,
  // campaigns: #119, #126, #131) add their handlers here.
  "consent.withdrawn": ["notifications.dispatch"],
  // Runs in worker-media only: the media queue (./queues.ts).
  "files.processing_requested": ["files.process_image"],
  // #85's Entries unit subscribes to these two.
  "files.file_processed": [],
  "files.file_processing_failed": [],
  "institution.verified": ["notifications.dispatch"],
  "institution.rejected": ["notifications.dispatch"],
  "institution.suspended": ["notifications.dispatch"],
  "institution.reinstated": ["notifications.dispatch"],
} as const satisfies { [T in EventType]: readonly string[] };

export type HandlerName = (typeof SUBSCRIBERS)[EventType][number];
