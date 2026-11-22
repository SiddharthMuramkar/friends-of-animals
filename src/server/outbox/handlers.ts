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

import type { FieldCipher } from "../crypto/field-cipher";
import type { AppDb } from "../db/app-db";
import { dispatchEvent } from "../modules/notifications/dispatch";
import { processImageAsset } from "../modules/files/process-image";
import { scanUploadedFile } from "../modules/files/scan-handler";
import { runStatusJob } from "../modules/competitions/advance-status";
import { publishPostImage } from "../modules/cms/posts/images";
import type { Clock } from "../ports/clock";
import type { EmailSender } from "../ports/email";
import type { MalwareScanner } from "../ports/malware-scanner";
import type { MediaProcessor } from "../ports/media";
import type { Settings } from "../ports/settings";
import type { SmsSender } from "../ports/sms";
import type { ObjectStorage } from "../ports/storage";
import type { EventOf, EventType, HandlerName, SUBSCRIBERS } from "./events";

/** What the relay and handlers run against; the worker can supply it. */
export type OutboxDeps = {
  db: AppDb;
  clock: Clock;
  email: EmailSender;
  sms: SmsSender;
  /** Runtime settings, such as whether messages may go by SMS. */
  settings: Settings;
  /** Reads a recipient's stored phone number. */
  cipher: FieldCipher;
  storage: ObjectStorage;
  scanner: MalwareScanner;
  /** Used only by the media queue's handlers, in worker-media. */
  media: MediaProcessor;
};

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
  // Sends the messages the event's route rows name (#69).
  "notifications.dispatch": dispatchEvent,
  "files.scan_file": (deps, { payload }) => scanUploadedFile(deps, payload),
  "files.process_image": (deps, delivery) => processImageAsset(deps, delivery),
  "competitions.advance_status": (deps, { payload }) =>
    runStatusJob(deps, payload),
  "cms.publish_post_image": (deps, { payload }) =>
    publishPostImage(deps, payload),
};

/** Whether this code has a handler by that name. */
export function isKnownHandler(name: string): name is HandlerName {
  return Object.hasOwn(HANDLERS, name);
}
