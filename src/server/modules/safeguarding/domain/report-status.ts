// The life of a safeguarding report (#116). Anyone files a concern through
// the public form and it starts `new`. A safeguarding lead triages it (sets
// how severe it is), then either resolves it at once (no action needed) or
// investigates. An investigation may be escalated to an outside authority
// (police, the Special Juvenile Police Unit, Childline) with that
// authority's reference, and every path ends `resolved` with an outcome.
// Resolved reports never move again; later facts go in the incident log.
//
// Pure, and loads under plain Node: the schema builds its enums from these
// lists, so they can't drift.

import { z } from "zod";

export const SAFEGUARDING_REPORT_STATUSES = [
  "new",
  "triaged",
  "investigating",
  "escalated",
  "resolved",
] as const;

export type SafeguardingReportStatus =
  (typeof SAFEGUARDING_REPORT_STATUSES)[number];

/** What every report starts as, straight from the public form. */
export const INITIAL_REPORT_STATUS: SafeguardingReportStatus = "new";

/** How urgent a lead judges a report to be. Unset until triage. */
export const SAFEGUARDING_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
] as const;

export type SafeguardingSeverity = (typeof SAFEGUARDING_SEVERITIES)[number];

export const REPORT_EVENTS = [
  /** The lead reads it and sets a severity. */
  "triage",
  /** The lead opens an investigation. */
  "start_investigation",
  /** The lead hands it to an outside authority, with their reference. */
  "escalate",
  /** Done, with an outcome (which may be "no action needed"). */
  "resolve",
] as const;

export type ReportEvent = (typeof REPORT_EVENTS)[number];

/**
 * Where each event takes a report, by status. A pair that isn't listed is
 * refused. Two are refused on purpose: a `new` report can't be resolved or
 * investigated before someone has triaged it.
 */
export const REPORT_TRANSITIONS: Readonly<
  Record<
    SafeguardingReportStatus,
    Readonly<Partial<Record<ReportEvent, SafeguardingReportStatus>>>
  >
> = {
  new: { triage: "triaged" },
  triaged: { start_investigation: "investigating", resolve: "resolved" },
  investigating: { escalate: "escalated", resolve: "resolved" },
  escalated: { resolve: "resolved" },
  resolved: {},
};

export type ReportTransitionRefusal =
  | "report_resolved"
  | "transition_not_allowed";

export type ReportTransition =
  | { ok: true; to: SafeguardingReportStatus }
  | { ok: false; reason: ReportTransitionRefusal };

/** Whether the report still needs a lead's attention. */
export function isOpenReport(status: SafeguardingReportStatus): boolean {
  return status !== "resolved";
}

/** Where `event` takes a report that is at `from`, if anywhere. */
export function decideReportTransition(input: {
  from: SafeguardingReportStatus;
  event: ReportEvent;
}): ReportTransition {
  const { from, event } = input;
  if (!isOpenReport(from)) return { ok: false, reason: "report_resolved" };
  const to = REPORT_TRANSITIONS[from][event];
  return to
    ? { ok: true, to }
    : { ok: false, reason: "transition_not_allowed" };
}

/** The events a lead may take next, in table order (for the queue's buttons). */
export function allowedReportEvents(
  status: SafeguardingReportStatus
): ReportEvent[] {
  return REPORT_EVENTS.filter((event) => REPORT_TRANSITIONS[status][event]);
}

export const INCIDENT_LOG_KINDS = [
  /** A lead's free-text note. */
  "note",
  /** A move through the table, written by the use case. */
  "status_change",
  /** A hand-over to an outside authority. */
  "escalation",
] as const;

export type IncidentLogKind = (typeof INCIDENT_LOG_KINDS)[number];

/** The incident log entry a move writes. */
export function incidentLogKindFor(event: ReportEvent): IncidentLogKind {
  return event === "escalate" ? "escalation" : "status_change";
}

/** Limits on what a lead types; the text is stored encrypted. */
export const AUTHORITY_REFERENCE_MAX = 200;
export const OUTCOME_MAX = 4000;

const requiredText = (max: number) => z.string().trim().min(1).max(max);

/**
 * What each event needs from the lead. Triage needs a severity, escalation
 * the authority's reference, and resolving an outcome. Unknown keys are
 * refused, so nothing rides along into the log.
 */
export const reportActionSchema = z.discriminatedUnion("event", [
  z.strictObject({
    event: z.literal("triage"),
    severity: z.enum(SAFEGUARDING_SEVERITIES),
  }),
  z.strictObject({ event: z.literal("start_investigation") }),
  z.strictObject({
    event: z.literal("escalate"),
    authorityReference: requiredText(AUTHORITY_REFERENCE_MAX),
  }),
  z.strictObject({
    event: z.literal("resolve"),
    outcome: requiredText(OUTCOME_MAX),
  }),
]);

export type ReportAction = z.infer<typeof reportActionSchema>;
