// Who a route's message goes to, and what each event lets a template say.
//
// A route row names an audience by key. Each audience turns an event into
// the users who receive it. Later tickets add an audience here (#81
// `guardian_of_participant`, #75 `institution_coordinators`) and route rows
// that use it, in a migration; #88 added `competition_managers`.
//
// Every message knows its recipient (RECIPIENT_VARIABLES). An event may
// give more variables (EVENT_VARIABLES): the names it provides and how to
// load their values from its payload. A template may only use what its
// routes' events and recipients provide; ./catalogue.test.ts checks every
// route row against this file.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq, or } from "drizzle-orm";
import { createFormatter, createTranslator } from "next-intl";

import adminRubrics from "../../../../messages/en-IN/adminRubrics.json";
import competitionStatus from "../../../../messages/en-IN/competitionStatus.json";
import { formats, LOCALE } from "../../../i18n/formats";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionTransitionBlock,
  institution,
  userRole,
} from "../../db/schema";
import type { Delivery, EventType } from "../../outbox";
import {
  CONTACT_MESSAGE_VARIABLES,
  contactMessageValues,
  contactTeamMembers,
} from "../contact/notify";
import { safeguardingLeads } from "../safeguarding/leads";
import {
  TRANSITION_BLOCK,
  type TransitionBlock,
} from "../competitions/domain/transition-block";

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
    case "safeguarding.report_submitted":
      // About a child, never about a user: only the leads hear of it.
      return null;
    case "cms.post_scheduled":
    case "cms.post_published":
      // A post (#112): it's about content, not a user.
      return null;
    case "competition.transition_blocked":
      // For the competition's managers (`competition_managers`).
      return null;
    case "rubric.published":
    case "competition.disciplines_changed":
      // Re-runs a refused move (#88); no route row names it.
      return null;
    case "registration.institution_registered":
      // The principal isn't a user: their message goes by its own handler
      // (#75), not by a route row.
      return null;
    case "registration.confirmed":
      // The family contact isn't a user: their message goes by its own
      // handler (#77), not by a route row.
      return null;
    case "payment.batch_captured":
      // Whoever started the payment gets the receipt (#77).
      return delivery.payload.payerUserId;
  }
}

/** The competition an event is about, if a competition audience applies. */
function competitionOf(delivery: Delivery): string | null {
  switch (delivery.eventType) {
    case "competition.transition_blocked":
      return delivery.payload.competitionId;
    default:
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
  /**
   * Everyone who manages the event's competition: a competition manager
   * scoped to it, or one with a global grant (#88).
   */
  competition_managers: async (db, delivery) => {
    const competitionId = competitionOf(delivery);
    if (!competitionId) return [];
    const rows = await db
      .selectDistinct({ userId: userRole.userId })
      .from(userRole)
      .where(
        and(
          eq(userRole.role, "competition_manager"),
          or(
            eq(userRole.scopeType, "global"),
            and(
              eq(userRole.scopeType, "competition"),
              eq(userRole.scopeId, competitionId)
            )
          )
        )
      )
      .orderBy(asc(userRole.userId));
    return rows.map((row) => row.userId);
  },
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

// A refused move's words come from messages/en-IN, like every other copy
// (FOA reviews them): the status as a sentence names it, why the move is
// held back, and each discipline as the rubric pages name it. A missing
// key fails the delivery loudly rather than mailing the key path.
function refuseFallback(error: Error): never {
  throw error;
}
const statusWords = createTranslator({
  locale: LOCALE,
  messages: competitionStatus,
  namespace: "competitionStatus",
  onError: refuseFallback,
});
const disciplineWords = createTranslator({
  locale: LOCALE,
  messages: adminRubrics,
  namespace: "adminRubrics.disciplines",
  onError: refuseFallback,
});
const format = createFormatter({ locale: LOCALE, formats });

/**
 * A refused move (#88): the competition, where it was going, and one
 * sentence on what stands in the way, from the block as it is when the
 * message goes.
 */
async function transitionBlockValues(
  db: AppDb,
  blockId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      name: competition.name,
      code: competition.code,
      to: competitionTransitionBlock.toStatus,
      reason: competitionTransitionBlock.reason,
      details: competitionTransitionBlock.details,
    })
    .from(competitionTransitionBlock)
    .innerJoin(
      competition,
      eq(competition.id, competitionTransitionBlock.competitionId)
    )
    .where(eq(competitionTransitionBlock.id, blockId));
  if (!row) return {};
  const block = TRANSITION_BLOCK.parse({ ...row.details, reason: row.reason });
  return {
    "competition.name": row.name,
    "competition.code": row.code,
    "transition.to": statusWords(`inSentence.${row.to}`),
    "transition.reason": reasonSentence(block),
  };
}

/** One sentence, for managers, on what holds a move back. */
function reasonSentence(block: TransitionBlock): string {
  switch (block.reason) {
    case "rubrics_missing":
      return statusWords("blockReason.rubrics_missing", {
        disciplines: format.list(
          block.missingDisciplines.map((discipline) =>
            disciplineWords(discipline)
          ),
          "and"
        ),
      });
  }
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
  // Nothing of the report: the alert says only that one came in (#116).
  "safeguarding.report_submitted": { names: [], load: async () => ({}) },
  "cms.post_scheduled": { names: [], load: async () => ({}) },
  "cms.post_published": { names: [], load: async () => ({}) },
  "rubric.published": { names: [], load: async () => ({}) },
  "competition.disciplines_changed": { names: [], load: async () => ({}) },
  "competition.transition_blocked": {
    names: [
      "competition.name",
      "competition.code",
      "transition.to",
      "transition.reason",
    ],
    load: (db, { payload }) => transitionBlockValues(db, payload.blockId),
  },
  "registration.institution_registered": {
    names: [],
    load: async () => ({}),
  },
  "registration.confirmed": { names: [], load: async () => ({}) },
  "payment.batch_captured": { names: [], load: async () => ({}) },
};

/** The variables a template on a route for `eventType` may use. */
export function variablesFor(eventType: EventType): string[] {
  return [...RECIPIENT_VARIABLES, ...EVENT_VARIABLES[eventType].names];
}
