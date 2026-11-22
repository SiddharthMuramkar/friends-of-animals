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

import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { institution } from "../../db/schema";
import type { Delivery, EventType } from "../../outbox";
import {
  CONTACT_MESSAGE_VARIABLES,
  contactMessageValues,
  contactTeamMembers,
} from "../contact/notify";

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
    case "institution.verified":
    case "institution.rejected":
    case "institution.suspended":
    case "institution.reinstated":
      // The authorised person, who registered the institution (#73).
      return delivery.payload.userId;
    case "competitions.key_date_scheduled":
      // A status job (#71): it's about a competition, not a user, and no
      // route row names it.
      return null;
    case "institution.coordinator_invited":
      // The invitee may have no account yet: the invitation goes to the
      // invited address by its own handler (#74), not by a route row.
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

/**
 * An institution's name and, once verified, its Institution ID (#73). Both
 * are read when the message goes: neither changes after the decision.
 */
async function institutionValues(
  db: AppDb,
  institutionId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({ name: institution.name, code: institution.institutionCode })
    .from(institution)
    .where(eq(institution.id, institutionId));
  if (!row) return {};
  return {
    "institution.name": row.name,
    ...(row.code === null ? {} : { "institution.code": row.code }),
  };
}

/** What each event lets a template say. */
export const EVENT_VARIABLES: { [T in EventType]: EventVariables<T> } = {
  "identity.user_signed_up": { names: [], load: async () => ({}) },
  "consent.withdrawn": { names: [], load: async () => ({}) },
  "files.file_uploaded": { names: [], load: async () => ({}) },
  "files.processing_requested": { names: [], load: async () => ({}) },
  "files.file_processed": { names: [], load: async () => ({}) },
  "files.file_processing_failed": { names: [], load: async () => ({}) },
  "institution.verified": {
    names: ["institution.name", "institution.code"],
    load: (db, { payload }) => institutionValues(db, payload.institutionId),
  },
  "institution.rejected": {
    names: ["institution.name"],
    load: (db, { payload }) => institutionValues(db, payload.institutionId),
  },
  "institution.suspended": {
    names: ["institution.name"],
    load: (db, { payload }) => institutionValues(db, payload.institutionId),
  },
  "institution.reinstated": {
    names: ["institution.name", "institution.code"],
    load: (db, { payload }) => institutionValues(db, payload.institutionId),
  },
  "competitions.key_date_scheduled": { names: [], load: async () => ({}) },
  "institution.coordinator_invited": { names: [], load: async () => ({}) },
  "contact_message.received": {
    names: CONTACT_MESSAGE_VARIABLES,
    load: async (db, delivery) =>
      (await contactMessageValues(db, delivery.payload.messageId)) ?? {},
  },
};

/** The variables a template on a route for `eventType` may use. */
export function variablesFor(eventType: EventType): string[] {
  return [...RECIPIENT_VARIABLES, ...EVENT_VARIABLES[eventType].names];
}
