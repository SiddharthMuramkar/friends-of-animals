// The domain events use cases emit, and which handlers each one goes to.
// Adding an event: add it to `DomainEvent`, give it a payload schema in
// EVENT_PAYLOADS, and list its handlers in SUBSCRIBERS (each name then
// needs an implementation in ./handlers.ts).
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import { z } from "zod";

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
  "files.processing_requested": z.object({ fileId: z.uuid() }),
  "files.file_processed": z.object({ fileId: z.uuid() }),
  "files.file_processing_failed": z.object({
    fileId: z.uuid(),
    code: z.enum(FILE_PROCESSING_ERROR_CODES),
  }),
} satisfies { [T in EventType]: z.ZodType<EventOf<T>["payload"]> };

/** The handlers each event is delivered to, one outbox row apiece. */
export const SUBSCRIBERS = {
  "identity.user_signed_up": ["notifications.send_welcome_email"],
  "files.file_uploaded": ["files.scan_file"],
  // Runs in worker-media only: the media queue (./queues.ts).
  "files.processing_requested": ["files.process_image"],
  // #85's Entries unit subscribes to these two.
  "files.file_processed": [],
  "files.file_processing_failed": [],
} as const satisfies { [T in EventType]: readonly string[] };

export type HandlerName = (typeof SUBSCRIBERS)[EventType][number];
