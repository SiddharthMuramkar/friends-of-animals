// What a safeguarding audit row may say (#116). Every view and change of a
// report is audited, and the audit log is append-only and outlives the
// report, so its `before` and `after` carry the report's status, severity
// and assignee only: never the description, the reporter, the child, the
// category, an outcome, an authority reference or a note's text. A note is
// recorded by its id and kind. Use cases build the JSON with the snapshots
// below, which parse it with strict schemas before it is written.
//
// The submission's own audit row is written without the request's IP and
// user agent and without a user id, so an anonymous report stays anonymous;
// that is the use case's job (../submit.ts), not this file's.
//
// Pure, and loads under plain Node.

import { z } from "zod";

import {
  INCIDENT_LOG_KINDS,
  SAFEGUARDING_REPORT_STATUSES,
  SAFEGUARDING_SEVERITIES,
  type IncidentLogKind,
  type SafeguardingReportStatus,
  type SafeguardingSeverity,
} from "./report-status";

/** The audit `action` of each safeguarding use case. */
export const SAFEGUARDING_AUDIT_ACTIONS = [
  "safeguarding.report_submitted",
  "safeguarding.queue_viewed",
  "safeguarding.report_viewed",
  "safeguarding.report_assigned",
  "safeguarding.report_triaged",
  "safeguarding.investigation_started",
  "safeguarding.report_escalated",
  "safeguarding.report_resolved",
  "safeguarding.incident_log_entry_added",
] as const;

export type SafeguardingAuditAction =
  (typeof SAFEGUARDING_AUDIT_ACTIONS)[number];

export const safeguardingReportAuditSchema = z.strictObject({
  status: z.enum(SAFEGUARDING_REPORT_STATUSES),
  severity: z.enum(SAFEGUARDING_SEVERITIES).nullable(),
  assignedToUserId: z.uuid().nullable(),
});

export type SafeguardingReportAudit = z.infer<
  typeof safeguardingReportAuditSchema
>;

/** The report fields a snapshot reads. Extra fields are ignored. */
export type AuditableReport = {
  status: SafeguardingReportStatus;
  severity: SafeguardingSeverity | null;
  assignedToUserId: string | null;
};

/** A report as its audit rows may show it. */
export function safeguardingReportAuditSnapshot(
  report: AuditableReport
): SafeguardingReportAudit {
  return safeguardingReportAuditSchema.parse({
    status: report.status,
    severity: report.severity,
    assignedToUserId: report.assignedToUserId,
  });
}

export const incidentLogEntryAuditSchema = z.strictObject({
  entryId: z.uuid(),
  kind: z.enum(INCIDENT_LOG_KINDS),
});

export type IncidentLogEntryAudit = z.infer<typeof incidentLogEntryAuditSchema>;

/** An incident log entry as its audit row may show it: id and kind only. */
export function incidentLogEntryAuditSnapshot(entry: {
  id: string;
  kind: IncidentLogKind;
}): IncidentLogEntryAudit {
  return incidentLogEntryAuditSchema.parse({
    entryId: entry.id,
    kind: entry.kind,
  });
}

export const queueViewAuditSchema = z.strictObject({
  /** How many reports the lead was shown; never which ones. */
  shown: z.int().min(0),
});

/** A view of the queue as its audit row may show it. */
export function queueViewAuditSnapshot(shown: number) {
  return queueViewAuditSchema.parse({ shown });
}
