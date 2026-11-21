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
  | {
      /** Someone took a place at an event or joined its waitlist (#125). */
      type: "event.registration_created";
      aggregate: { type: "event_registration"; id: string };
      payload: {
        registrationId: string;
        eventId: string;
        status: "registered" | "waitlisted";
      };
    }
  | {
      /** A freed or added place went to the person waiting longest. */
      type: "event.waitlist_promoted";
      aggregate: { type: "event_registration"; id: string };
      payload: { registrationId: string; eventId: string };
    }
  | {
      /** The attendee, a guardian or staff withdrew a registration. */
      type: "event.registration_cancelled";
      aggregate: { type: "event_registration"; id: string };
      payload: { registrationId: string; eventId: string };
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
  "event.registration_created": z.object({
    registrationId: z.uuid(),
    eventId: z.uuid(),
    status: z.enum(["registered", "waitlisted"]),
  }),
  "event.waitlist_promoted": z.object({
    registrationId: z.uuid(),
    eventId: z.uuid(),
  }),
  "event.registration_cancelled": z.object({
    registrationId: z.uuid(),
    eventId: z.uuid(),
  }),
} satisfies { [T in EventType]: z.ZodType<EventOf<T>["payload"]> };

/** The handlers each event is delivered to, one outbox row apiece. */
export const SUBSCRIBERS = {
  "identity.user_signed_up": ["notifications.send_welcome_email"],
  // No handler yet: #69's notifications.dispatch subscribes these once it
  // is on this branch, and until then emit() writes nothing for them.
  "event.registration_created": [],
  "event.waitlist_promoted": [],
  "event.registration_cancelled": [],
} as const satisfies { [T in EventType]: readonly string[] };

export type HandlerName = (typeof SUBSCRIBERS)[EventType][number];
