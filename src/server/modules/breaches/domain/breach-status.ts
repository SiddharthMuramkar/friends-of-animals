// The life of a personal-data breach record (#116). Staff record a breach
// as soon as FOA becomes aware of it, and it starts `open`. It is
// contained, and affected people and the authority are notified; a notice
// may go out before containment. A breach that needs no notice (no
// personal data reached anyone) is closed from `contained` with a reason.
// One that was notified closes only once it is also contained. Closed
// breaches never move again.
//
// `notified` is reached by the first notice of either kind; later notices
// keep it there. Containing a breach that is already `notified` stamps the
// containment time without moving it, so "notice before containment" never
// loses the containment record.
//
// Pure, and loads under plain Node: the schema builds its enums from these
// lists, so they can't drift.

import { z } from "zod";

export const BREACH_STATUSES = [
  "open",
  "contained",
  "notified",
  "closed",
] as const;

export type BreachStatus = (typeof BREACH_STATUSES)[number];

/** What every breach record starts as. */
export const INITIAL_BREACH_STATUS: BreachStatus = "open";

export const BREACH_SEVERITIES = ["critical", "high", "medium", "low"] as const;

export type BreachSeverity = (typeof BREACH_SEVERITIES)[number];

export const BREACH_EVENTS = [
  /** The cause is stopped and no more data is leaving. */
  "contain",
  /** A notice went to affected people or to the authority. */
  "notify",
  /** Nothing is left to do. */
  "close",
] as const;

export type BreachEvent = (typeof BREACH_EVENTS)[number];

/**
 * Where each event takes a breach, by status. A pair that isn't listed is
 * refused: an open breach can't be closed, a closed one never moves, and a
 * notified one never goes back to open.
 */
export const BREACH_TRANSITIONS: Readonly<
  Record<BreachStatus, Readonly<Partial<Record<BreachEvent, BreachStatus>>>>
> = {
  open: { contain: "contained", notify: "notified" },
  contained: { notify: "notified", close: "closed" },
  notified: { contain: "notified", notify: "notified", close: "closed" },
  closed: {},
};

export type BreachTransitionRefusal =
  | "breach_closed"
  | "transition_not_allowed"
  | "already_contained"
  | "not_contained"
  | "reason_required"
  | "fan_out_pending"
  | "principal_notices_pending"
  | "authority_notice_pending";

export type BreachTransition =
  | { ok: true; to: BreachStatus; stampContainedAt: boolean }
  | { ok: false; reason: BreachTransitionRefusal };

/** The breach fields a decision reads. */
export type BreachState = {
  status: BreachStatus;
  containedAt: Date | null;
  authorityEmailQueuedAt: Date | null;
};

/**
 * Where `event` takes `breach`, if anywhere. Closing from `contained`
 * needs `noNoticeReason` and no outstanding notices; closing from
 * `notified` needs the breach to be contained first.
 */
export function decideBreachTransition(
  breach: BreachState,
  event: BreachEvent,
  options: {
    noNoticeReason?: string | undefined;
    fanOutPending?: boolean;
    principalNoticesPending?: boolean;
  } = {}
): BreachTransition {
  const { status, containedAt } = breach;
  if (status === "closed") return { ok: false, reason: "breach_closed" };
  if (event === "contain" && containedAt !== null) {
    return { ok: false, reason: "already_contained" };
  }
  const to = BREACH_TRANSITIONS[status][event];
  if (!to) return { ok: false, reason: "transition_not_allowed" };
  if (event === "close") {
    if (status === "notified" && containedAt === null) {
      return { ok: false, reason: "not_contained" };
    }
    if (status === "contained" && !options.noNoticeReason?.trim()) {
      return { ok: false, reason: "reason_required" };
    }
    if (status === "contained" && options.fanOutPending) {
      return { ok: false, reason: "fan_out_pending" };
    }
    if (status === "contained" && options.principalNoticesPending) {
      return { ok: false, reason: "principal_notices_pending" };
    }
    if (status === "contained" && breach.authorityEmailQueuedAt !== null) {
      return { ok: false, reason: "authority_notice_pending" };
    }
  }
  return { ok: true, to, stampContainedAt: event === "contain" };
}

/** The events staff may take next, in table order (for the page's buttons). */
export function allowedBreachEvents(
  breach: BreachState,
  fanOutPending = false,
  principalNoticesPending = false
): BreachEvent[] {
  return BREACH_EVENTS.filter(
    (event) =>
      decideBreachTransition(breach, event, {
        noNoticeReason: "-",
        fanOutPending,
        principalNoticesPending,
      }).ok
  );
}

export const BREACH_TIMELINE_KINDS = [
  "recorded",
  "updated",
  "contained",
  "principals_notified",
  "authority_notified",
  "note",
  "closed",
] as const;

export type BreachTimelineKind = (typeof BREACH_TIMELINE_KINDS)[number];

export const BREACH_TITLE_MAX = 200;
export const BREACH_IMPACT_MAX = 4000;
export const BREACH_NOTE_MAX = 4000;
export const NO_NOTICE_REASON_MAX = 1000;
export const BREACH_AFFECTED_COUNT_MAX = 2_147_483_647;

/**
 * What staff enter to record a breach. `awareAt` is when FOA learnt of it,
 * which may be before the record is made but never after; the use case
 * checks it against the clock.
 */
export const breachRecordSchema = z.strictObject({
  title: z.string().trim().min(1).max(BREACH_TITLE_MAX),
  awareAt: z.union([
    z.date(),
    z.iso.datetime({ offset: true }).pipe(z.coerce.date()),
  ]),
  severity: z.enum(BREACH_SEVERITIES),
  personalDataInvolved: z.boolean(),
  minorsAffected: z.boolean(),
  /** A best estimate; refined as the investigation goes on. */
  affectedCount: z.int().min(0).max(BREACH_AFFECTED_COUNT_MAX),
  impact: z.string().trim().min(1).max(BREACH_IMPACT_MAX),
});

export type BreachRecordInput = z.infer<typeof breachRecordSchema>;

/** The fields staff may correct after recording; `awareAt` stays as recorded. */
export const BREACH_UPDATABLE_FIELDS = [
  "title",
  "severity",
  "personalDataInvolved",
  "minorsAffected",
  "affectedCount",
  "impact",
] as const;

export type BreachUpdatableField = (typeof BREACH_UPDATABLE_FIELDS)[number];
