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
    };

export type EventType = DomainEvent["type"];

export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;

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
  "contact_message.received": z.object({ messageId: z.uuid() }),
  "safeguarding.report_submitted": z.object({ reportId: z.uuid() }),
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
  // The team's in-app note goes by route row; the sender, who has no
  // account, gets the acknowledgement from the contact module.
  "contact_message.received": [
    "notifications.dispatch",
    "contact.send_acknowledgement",
  ],
  // The safeguarding leads' alert (#116).
  "safeguarding.report_submitted": ["notifications.dispatch"],
} as const satisfies { [T in EventType]: readonly string[] };

export type HandlerName = (typeof SUBSCRIBERS)[EventType][number];
