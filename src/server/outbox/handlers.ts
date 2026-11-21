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

import type { AppDb } from "../db/app-db";
import { checkDispatchReminder } from "../modules/physical-artwork/reminder";
import { sendWelcomeEmail } from "../notifications/welcome-email";
import type { Clock } from "../ports/clock";
import type { EmailSender } from "../ports/email";
import type { EventOf, EventType, HandlerName, SUBSCRIBERS } from "./events";

/** What the relay and handlers run against; the worker can supply it. */
export type OutboxDeps = { db: AppDb; clock: Clock; email: EmailSender };

/** The event a handler listens to, from SUBSCRIBERS. */
type EventFor<H extends HandlerName> = {
  [T in EventType]: H extends (typeof SUBSCRIBERS)[T][number] ? T : never;
}[EventType];

/** One delivery, as its handler receives it. */
export type Delivery<T extends EventType = EventType> = {
  /** The outbox row's id: the delivery's idempotency key. */
  id: string;
  eventId: string;
  occurredAt: Date;
  /** 1 on the first try. */
  attempt: number;
  payload: EventOf<T>["payload"];
};

type Handlers = {
  [H in HandlerName]: (
    deps: OutboxDeps,
    delivery: Delivery<EventFor<H>>
  ) => Promise<void>;
};

export const HANDLERS: Handlers = {
  "notifications.send_welcome_email": (deps, { payload }) =>
    sendWelcomeEmail(deps, payload),
  "physical_artwork.check_dispatch_reminder": (deps, { payload }) =>
    checkDispatchReminder(deps, payload),
};

/** Whether this code has a handler by that name. */
export function isKnownHandler(name: string): name is HandlerName {
  return Object.hasOwn(HANDLERS, name);
}
