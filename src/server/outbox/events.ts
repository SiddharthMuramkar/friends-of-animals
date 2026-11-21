// The domain events use cases emit, and which handlers each one goes to.
// Adding an event: add it to `DomainEvent`, give it a payload schema in
// EVENT_PAYLOADS, and list its handlers in SUBSCRIBERS (each name then
// needs an implementation in ./handlers.ts).
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import { z } from "zod";

type PhysicalArtwork = { type: "physical_artwork"; id: string };

export type DomainEvent =
  | {
      type: "identity.user_signed_up";
      aggregate: { type: "user"; id: string };
      payload: { userId: string };
    }
  | {
      /** FOA asked an entry for its original work (#93). */
      type: "artwork.requested";
      aggregate: PhysicalArtwork;
      payload: { artworkId: string };
    }
  | {
      /** The sender recorded the courier; `late` once past the deadline. */
      type: "artwork.dispatched";
      aggregate: PhysicalArtwork;
      payload: { artworkId: string; late: boolean };
    }
  | {
      /** FOA has the parcel; the sender gets an acknowledgement. */
      type: "artwork.received";
      aggregate: PhysicalArtwork;
      payload: { artworkId: string; dispatchRecorded: boolean };
    }
  | {
      /**
       * Emitted with the request, available at the reminder instant: the
       * handler checks the artwork again before anyone is reminded.
       */
      type: "artwork.dispatch_reminder_due";
      aggregate: PhysicalArtwork;
      payload: { artworkId: string };
    }
  | {
      /** Still not dispatched before the deadline: remind the sender. */
      type: "artwork.dispatch_reminder";
      aggregate: PhysicalArtwork;
      payload: { artworkId: string };
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
  "artwork.requested": z.object({ artworkId: z.uuid() }),
  "artwork.dispatched": z.object({ artworkId: z.uuid(), late: z.boolean() }),
  "artwork.received": z.object({
    artworkId: z.uuid(),
    dispatchRecorded: z.boolean(),
  }),
  "artwork.dispatch_reminder_due": z.object({ artworkId: z.uuid() }),
  "artwork.dispatch_reminder": z.object({ artworkId: z.uuid() }),
} satisfies { [T in EventType]: z.ZodType<EventOf<T>["payload"]> };

/** The handlers each event is delivered to, one outbox row apiece. */
export const SUBSCRIBERS = {
  "identity.user_signed_up": ["notifications.send_welcome_email"],
  // The sender's messages (request notice, acknowledgement, reminder) go
  // out once #69's notifications.dispatch subscribes to these three.
  "artwork.requested": [],
  "artwork.dispatched": [],
  "artwork.received": [],
  "artwork.dispatch_reminder_due": ["physical_artwork.check_dispatch_reminder"],
  "artwork.dispatch_reminder": [],
} as const satisfies { [T in EventType]: readonly string[] };

export type HandlerName = (typeof SUBSCRIBERS)[EventType][number];
