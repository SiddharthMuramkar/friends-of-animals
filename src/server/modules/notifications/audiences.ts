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

import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionTransitionBlock,
  institution,
  userRole,
} from "../../db/schema";
import type { Delivery, EventType } from "../../outbox";
import {
  TRANSITION_BLOCK,
  type TransitionBlock,
} from "../competitions/domain/transition-block";
import type {
  CompetitionStatus,
  Discipline,
} from "../competitions/domain/vocabulary";

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
    case "competition.transition_blocked":
      // For the competition's managers (`competition_managers`).
      return null;
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

/** How a notice names a status a guarded move goes to. */
const STATUS_WORDS: Partial<Record<CompetitionStatus, string>> = {
  school_judging: "school judging",
};

/** Discipline names in English, as the admin pages show them. */
const DISCIPLINE_WORDS: Record<Discipline, string> = {
  drawing: "Drawing",
  painting: "Painting",
  art: "Art",
  craft: "Craft",
  essay: "Essay",
  photography: "Photography",
  videography: "Videography",
};

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
    "transition.to": STATUS_WORDS[row.to] ?? row.to.replaceAll("_", " "),
    "transition.reason": reasonSentence(block),
  };
}

/** One sentence, for managers, on what holds a move back. */
function reasonSentence(block: TransitionBlock): string {
  switch (block.reason) {
    case "rubrics_missing": {
      const missing = block.missingDisciplines
        .map((discipline) => DISCIPLINE_WORDS[discipline])
        .join(", ");
      return `These disciplines have no published rubric yet: ${missing}.`;
    }
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
  "competition.transition_blocked": {
    names: [
      "competition.name",
      "competition.code",
      "transition.to",
      "transition.reason",
    ],
    load: (db, { payload }) => transitionBlockValues(db, payload.blockId),
  },
};

/** The variables a template on a route for `eventType` may use. */
export function variablesFor(eventType: EventType): string[] {
  return [...RECIPIENT_VARIABLES, ...EVENT_VARIABLES[eventType].names];
}
