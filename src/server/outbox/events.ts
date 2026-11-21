// The domain events use cases emit, and which handlers each one goes to.
// Adding an event: add it to `DomainEvent`, give it a payload schema in
// EVENT_PAYLOADS, and list its handlers in SUBSCRIBERS (each name then
// needs an implementation in ./handlers.ts).
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import { z } from "zod";

export type DomainEvent =
  | {
      type: "identity.user_signed_up";
      aggregate: { type: "user"; id: string };
      payload: { userId: string };
    }
  | EventsDomainEvent;

/**
 * An event or campaign was published, changed or cancelled (#125). A change
 * says what registrants must hear about: a new time, a new place, and
 * whether the start moved (reminders count back from it).
 */
type EventsDomainEvent =
  | {
      type: "event.published";
      aggregate: { type: "event"; id: string };
      payload: { eventId: string };
    }
  | {
      type: "event.cancelled";
      aggregate: { type: "event"; id: string };
      payload: { eventId: string };
    }
  | {
      type: "event.changed";
      aggregate: { type: "event"; id: string };
      payload: {
        eventId: string;
        timeChanged: boolean;
        placeChanged: boolean;
        startMoved: boolean;
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
  "event.published": z.object({ eventId: z.uuid() }),
  "event.changed": z.object({
    eventId: z.uuid(),
    timeChanged: z.boolean(),
    placeChanged: z.boolean(),
    startMoved: z.boolean(),
  }),
  "event.cancelled": z.object({ eventId: z.uuid() }),
} satisfies { [T in EventType]: z.ZodType<EventOf<T>["payload"]> };

/** The handlers each event is delivered to, one outbox row apiece. */
export const SUBSCRIBERS = {
  "identity.user_signed_up": ["notifications.send_welcome_email"],
  // Registration (125b) subscribes to these for change notices.
  "event.published": [],
  "event.changed": [],
  "event.cancelled": [],
} as const satisfies { [T in EventType]: readonly string[] };

export type HandlerName = (typeof SUBSCRIBERS)[EventType][number];
