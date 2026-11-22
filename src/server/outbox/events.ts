// The domain events use cases emit, and which handlers each one goes to.
// Adding an event: add it to `DomainEvent`, give it a payload schema in
// EVENT_PAYLOADS, and list its handlers in SUBSCRIBERS (each name then
// needs an implementation in ./handlers.ts).
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import { z } from "zod";

import {
  KEY_DATE_KINDS,
  type KeyDateKind,
} from "../modules/competitions/domain/key-dates";

export type DomainEvent =
  | {
      type: "identity.user_signed_up";
      aggregate: { type: "user"; id: string };
      payload: { userId: string };
    }
  | {
      /**
       * A published competition's key date was set for `dueAt` (#71), on
       * publishing or by an edit. Saved with `availableAt: dueAt`, so its
       * status job runs once the date arrives.
       */
      type: "competitions.key_date_scheduled";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string; kind: KeyDateKind; dueAt: string };
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
  "competitions.key_date_scheduled": z.object({
    competitionId: z.uuid(),
    kind: z.enum(KEY_DATE_KINDS),
    dueAt: z.iso.datetime(),
  }),
} satisfies { [T in EventType]: z.ZodType<EventOf<T>["payload"]> };

/** The handlers each event is delivered to, one outbox row apiece. */
export const SUBSCRIBERS = {
  "identity.user_signed_up": ["notifications.send_welcome_email"],
  "competitions.key_date_scheduled": ["competitions.advance_status"],
} as const satisfies { [T in EventType]: readonly string[] };

export type HandlerName = (typeof SUBSCRIBERS)[EventType][number];
