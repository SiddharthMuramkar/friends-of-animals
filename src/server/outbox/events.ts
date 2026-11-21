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

export type DomainEvent =
  | {
      type: "identity.user_signed_up";
      aggregate: { type: "user"; id: string };
      payload: { userId: string };
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
      /** A message arrived through the contact form (#113). */
      type: "contact_message.received";
      aggregate: { type: "contact_message"; id: string };
      payload: { messageId: string };
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
  "consent.withdrawn": z.object({
    consentEventId: z.uuid(),
    subjectType: z.enum(CONSENT_SUBJECT_TYPES),
    subjectId: z.uuid(),
    purpose: z.enum(GIVABLE_PURPOSES),
    documentId: z.uuid(),
  }),
  "contact_message.received": z.object({ messageId: z.uuid() }),
} satisfies { [T in EventType]: z.ZodType<EventOf<T>["payload"]> };

/**
 * The handlers each event is delivered to, one outbox row apiece. Every
 * event goes to notifications.dispatch, which sends whatever its route
 * rows (message_route) name, and nothing when it has none.
 */
export const SUBSCRIBERS = {
  "identity.user_signed_up": ["notifications.dispatch"],
  // The modules that act on a withdrawal (gallery, social, auctions,
  // campaigns: #119, #126, #131) add their handlers here.
  "consent.withdrawn": ["notifications.dispatch"],
  // The team's in-app note goes by route row; the sender, who has no
  // account, gets the acknowledgement from the contact module.
  "contact_message.received": [
    "notifications.dispatch",
    "contact.send_acknowledgement",
  ],
} as const satisfies { [T in EventType]: readonly string[] };

/** Welcome deliveries written before the notification dispatcher was added. */
export const LEGACY_WELCOME_HANDLER = "notifications.send_welcome_email";

export type HandlerName =
  | (typeof SUBSCRIBERS)[EventType][number]
  | typeof LEGACY_WELCOME_HANDLER;
