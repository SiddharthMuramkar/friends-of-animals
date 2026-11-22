// Who a route's message goes to, and what each event lets a template say.
//
// A route row names an audience by key. Each audience turns an event into
// the users who receive it. Later tickets add an audience here (#81
// `guardian_of_participant`, #75 `institution_coordinators`) and route rows
// that use it, in a migration.
//
// Every message knows its recipient (RECIPIENT_VARIABLES). An event may
// give more variables (EVENT_VARIABLES): the names it provides and how to
// load their values from its payload. A template may only use what its
// routes' events and recipients provide; ./catalogue.test.ts checks every
// route row against this file.
//
// Loads under plain Node (the worker): relative imports only.

import type { AppDb } from "../../db/app-db";
import type { Delivery, EventType } from "../../outbox";
import {
  CONTACT_MESSAGE_VARIABLES,
  contactMessageValues,
  contactTeamMembers,
} from "../contact/notify";
import { safeguardingLeads } from "../safeguarding/leads";

/** The variables every message has about the person receiving it. */
export const RECIPIENT_VARIABLES = ["recipient.name"] as const;

/** The user an event is about, if it is about a user. */
function subjectUserOf(delivery: Delivery): string | null {
  switch (delivery.eventType) {
    case "identity.user_signed_up":
      return delivery.payload.userId;
    case "consent.withdrawn":
      // A participant profile's consent (#82) is not a user's.
      return delivery.payload.subjectType === "user"
        ? delivery.payload.subjectId
        : null;
    case "contact_message.received":
      // A visitor's message (#113): its sender has no account.
      return null;
    case "files.file_uploaded":
    case "files.processing_requested":
    case "files.file_processed":
    case "files.file_processing_failed":
      // A file's own pipeline (#63, #85), not a message route: no route
      // row names these events.
      return null;
    case "safeguarding.report_submitted":
      // About a child, never about a user: only the leads hear of it.
      return null;
  }
}

type Audience = (db: AppDb, delivery: Delivery) => Promise<string[]>;

/** Each audience key a route may name, and the user ids it resolves to. */
export const AUDIENCES = {
  /** The user the event is about: the new account, the one who withdrew. */
  subject_user: async (_db, delivery) => {
    const userId = subjectUserOf(delivery);
    return userId ? [userId] : [];
  },
  /**
   * Whoever wrote through the contact form (#113). They have no account, so
   * no user receives it here: the contact module emails their address with
   * this route's template while the route is enabled.
   */
  contact_sender: async () => [],
  /** The staff team a contact message was routed to (#113). */
  contact_team: async (db, delivery) =>
    delivery.eventType === "contact_message.received"
      ? contactTeamMembers(db, delivery.payload.messageId)
      : [],
  /** Every safeguarding lead (#116), whatever the event. */
  safeguarding_leads: async (db) =>
    (await safeguardingLeads(db)).map((lead) => lead.id),
} satisfies Record<string, Audience>;

export type AudienceKey = keyof typeof AUDIENCES;

export function isAudienceKey(key: string): key is AudienceKey {
  return Object.hasOwn(AUDIENCES, key);
}

type EventVariables<T extends EventType> = {
  /** The names it provides, beyond RECIPIENT_VARIABLES. */
  names: readonly string[];
  load(db: AppDb, delivery: Delivery<T>): Promise<Record<string, string>>;
};

/** What each event lets a template say. None gives any extra yet. */
export const EVENT_VARIABLES: { [T in EventType]: EventVariables<T> } = {
  "identity.user_signed_up": { names: [], load: async () => ({}) },
  "consent.withdrawn": { names: [], load: async () => ({}) },
  "files.file_uploaded": { names: [], load: async () => ({}) },
  "files.processing_requested": { names: [], load: async () => ({}) },
  "files.file_processed": { names: [], load: async () => ({}) },
  "files.file_processing_failed": { names: [], load: async () => ({}) },
  "contact_message.received": {
    names: CONTACT_MESSAGE_VARIABLES,
    load: async (db, delivery) =>
      (await contactMessageValues(db, delivery.payload.messageId)) ?? {},
  },
  // Nothing of the report: the alert says only that one came in (#116).
  "safeguarding.report_submitted": { names: [], load: async () => ({}) },
};

/** The variables a template on a route for `eventType` may use. */
export function variablesFor(eventType: EventType): string[] {
  return [...RECIPIENT_VARIABLES, ...EVENT_VARIABLES[eventType].names];
}
