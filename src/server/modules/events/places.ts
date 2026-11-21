// An event's places and its waitlist (#125): registering, cancelling and
// promoting the people waiting, on the `event_registration` table.
//
// Every write here runs inside the transaction that locked the event's row
// (SELECT ... FOR UPDATE on 125a's `event` table), so two registrations
// can't both take the last place and a freed place is promoted before
// anyone else can see it. The caller loads the event with that lock and
// passes it in; these functions count the rows, apply the pure rules in
// ./domain and write, with any outbox event in the same transaction.

import type { RegistrationWindowEvent } from "./domain/registration-window";
import type { EventAudience } from "./domain/event-details";

/** What the registration rules read from the event's row. */
export type RegistrableEvent = RegistrationWindowEvent & {
  id: string;
  /** null: unlimited places. */
  capacity: number | null;
  waitlistEnabled: boolean;
  audience: EventAudience;
};

/** Who comes: an adult's own account, or a child's participant profile. */
export type Attendee =
  | { kind: "user"; userId: string }
  | { kind: "profile"; participantProfileId: string };
