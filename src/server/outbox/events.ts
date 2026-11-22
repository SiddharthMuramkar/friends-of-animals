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
import {
  DISCIPLINES,
  type Discipline,
} from "../modules/competitions/domain/vocabulary";
import {
  CONSENT_SUBJECT_TYPES,
  GIVABLE_PURPOSES,
  type ConsentSubjectType,
  type GivablePurpose,
} from "../modules/consent/domain/purposes";
import { FILE_PROCESSING_ERROR_CODES } from "../ports/media";

/**
 * FOA staff decided about an institution (#73). `userId` is its authorised
 * person, who registered it.
 */
type InstitutionDecided<T extends `institution.${string}`> = {
  type: T;
  aggregate: { type: "institution"; id: string };
  payload: { institutionId: string; userId: string };
};

export type DomainEvent =
  | {
      type: "identity.user_signed_up";
      aggregate: { type: "user"; id: string };
      payload: { userId: string };
    }
  | {
      /** An upload matched its declaration and awaits its malware scan. */
      type: "files.file_uploaded";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
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
      /** A clean file has derivatives to make: worker-media's job (#85). */
      type: "files.processing_requested";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
    }
  | {
      /** Every derivative of the file is stored. */
      type: "files.file_processed";
      aggregate: { type: "file_asset"; id: string };
      payload: { fileId: string };
    }
  | {
      /** The file's derivatives can't be made, for good. */
      type: "files.file_processing_failed";
      aggregate: { type: "file_asset"; id: string };
      payload: {
        fileId: string;
        code: (typeof FILE_PROCESSING_ERROR_CODES)[number];
      };
    }
  /** Verified for the first time: it has its Institution ID. */
  | InstitutionDecided<"institution.verified">
  /** Its registration wasn't accepted; the person may register again. */
  | InstitutionDecided<"institution.rejected">
  /** Suspended for now; it keeps its Institution ID and its admin. */
  | InstitutionDecided<"institution.suspended">
  /** Verified again after a suspension, with the Institution ID it had. */
  | InstitutionDecided<"institution.reinstated">
  | {
      /**
       * A published competition's key date was set for `dueAt` (#71), on
       * publishing or by an edit. Saved with `availableAt: dueAt`, so its
       * status job runs once the date arrives.
       */
      type: "competitions.key_date_scheduled";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string; kind: KeyDateKind; dueAt: string };
    }
  | {
      /** An authorised person invited a coordinator (#74). */
      type: "institution.coordinator_invited";
      aggregate: { type: "institution_invitation"; id: string };
      payload: { invitationId: string };
    }
  | {
      /** A message arrived through the contact form (#113). */
      type: "contact_message.received";
      aggregate: { type: "contact_message"; id: string };
      payload: { messageId: string };
    }
  | {
      /**
       * Someone reported a safeguarding concern (#116). The leads' alert
       * says only that one came in: nothing of the report travels here.
       */
      type: "safeguarding.report_submitted";
      aggregate: { type: "safeguarding_report"; id: string };
      payload: { reportId: string };
    }
  | {
      /**
       * A guard refused a scheduled move of the competition (#88): the
       * open competition_transition_block row `blockId` says why. Emitted
       * once per refused move, so its managers are told once.
       */
      type: "competition.transition_blocked";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string; blockId: string };
    }
  | {
      /**
       * A competition manager published a rubric (#88). A move of its
       * competition the guards refused is tried again.
       */
      type: "rubric.published";
      aggregate: { type: "rubric"; id: string };
      payload: {
        rubricId: string;
        competitionId: string;
        discipline: Discipline;
        version: number;
      };
    }
  | {
      /**
       * A competition manager changed the disciplines of a competition
       * whose move a guard refused (#88). The move is tried again, since
       * the disciplines are what the school-judging guard checks. Not
       * emitted while no move is refused: nothing else needs it yet.
       */
      type: "competition.disciplines_changed";
      aggregate: { type: "competition"; id: string };
      payload: { competitionId: string };
    };

export type EventType = DomainEvent["type"];

export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;

const INSTITUTION_DECIDED = z.object({
  institutionId: z.uuid(),
  userId: z.uuid(),
});

/**
 * Each event's payload: ids only, never an address, a name or a phone
 * number, because rows outlive the change and staff read failed ones.
 * Parsing strips any other key, so a payload built by spreading a record
 * can't carry personal data into the table.
 */
export const EVENT_PAYLOADS = {
  "identity.user_signed_up": z.object({ userId: z.uuid() }),
  "files.file_uploaded": z.object({ fileId: z.uuid() }),
  "consent.withdrawn": z.object({
    consentEventId: z.uuid(),
    subjectType: z.enum(CONSENT_SUBJECT_TYPES),
    subjectId: z.uuid(),
    purpose: z.enum(GIVABLE_PURPOSES),
    documentId: z.uuid(),
  }),
  "files.processing_requested": z.object({ fileId: z.uuid() }),
  "files.file_processed": z.object({ fileId: z.uuid() }),
  "files.file_processing_failed": z.object({
    fileId: z.uuid(),
    code: z.enum(FILE_PROCESSING_ERROR_CODES),
  }),
  "institution.verified": INSTITUTION_DECIDED,
  "institution.rejected": INSTITUTION_DECIDED,
  "institution.suspended": INSTITUTION_DECIDED,
  "institution.reinstated": INSTITUTION_DECIDED,
  "competitions.key_date_scheduled": z.object({
    competitionId: z.uuid(),
    kind: z.enum(KEY_DATE_KINDS),
    dueAt: z.iso.datetime(),
  }),
  "institution.coordinator_invited": z.object({ invitationId: z.uuid() }),
  "contact_message.received": z.object({ messageId: z.uuid() }),
  "safeguarding.report_submitted": z.object({ reportId: z.uuid() }),
  "competition.transition_blocked": z.object({
    competitionId: z.uuid(),
    blockId: z.uuid(),
  }),
  "rubric.published": z.object({
    rubricId: z.uuid(),
    competitionId: z.uuid(),
    discipline: z.enum(DISCIPLINES),
    version: z.int().min(1),
  }),
  "competition.disciplines_changed": z.object({ competitionId: z.uuid() }),
} satisfies { [T in EventType]: z.ZodType<EventOf<T>["payload"]> };

/**
 * The handlers each event is delivered to, one outbox row apiece. Every
 * event a message may follow goes to notifications.dispatch, which sends
 * whatever its route rows (message_route) name, and nothing when it has
 * none.
 */
export const SUBSCRIBERS = {
  "identity.user_signed_up": ["notifications.dispatch"],
  "files.file_uploaded": ["files.scan_file"],
  // The modules that act on a withdrawal (gallery, social, auctions,
  // campaigns: #119, #126, #131) add their handlers here.
  "consent.withdrawn": ["notifications.dispatch"],
  // Runs in worker-media only: the media queue (./queues.ts).
  "files.processing_requested": ["files.process_image"],
  // #85's Entries unit subscribes to these two.
  "files.file_processed": [],
  "files.file_processing_failed": [],
  "institution.verified": ["notifications.dispatch"],
  "institution.rejected": ["notifications.dispatch"],
  "institution.suspended": ["notifications.dispatch"],
  "institution.reinstated": ["notifications.dispatch"],
  "competitions.key_date_scheduled": ["competitions.advance_status"],
  // An invitee has no account yet, so no route row can name them: the
  // invitation goes to the invited address itself (#74).
  "institution.coordinator_invited": [
    "institutions.send_coordinator_invitation",
  ],
  // The team's in-app note goes by route row; the sender, who has no
  // account, gets the acknowledgement from the contact module.
  "contact_message.received": [
    "notifications.dispatch",
    "contact.send_acknowledgement",
  ],
  // The safeguarding leads' alert (#116).
  "safeguarding.report_submitted": ["notifications.dispatch"],
  "competition.transition_blocked": ["notifications.dispatch"],
  // Each guard's retryOn events (modules/competitions/transition-guards.ts).
  "rubric.published": ["competitions.retry_blocked_moves"],
  "competition.disciplines_changed": ["competitions.retry_blocked_moves"],
} as const satisfies { [T in EventType]: readonly string[] };

export type HandlerName = (typeof SUBSCRIBERS)[EventType][number];
