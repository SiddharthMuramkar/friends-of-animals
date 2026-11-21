// The safeguarding lead's queue and report page (#116).
//
//   listSafeguardingReports({ view })  → open (default) or resolved reports
//   viewSafeguardingReport({ reportId }) → one report, decrypted, with its
//                                          incident log
//
// Both are lead-only and both are audited: the list by how many reports it
// showed, a view by the report's status, severity and assignee. The queue
// shows no free text, so a glance at it never exposes a description.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { AppDb } from "../../db/app-db";
import {
  safeguardingIncidentLog,
  safeguardingReport,
  user,
  userRole,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import { open, openOrNull } from "./content";
import {
  queueViewAuditSnapshot,
  safeguardingReportAuditSnapshot,
} from "./domain/audit";
import type { ConcernCategory } from "./domain/concern";
import {
  allowedReportEvents,
  type IncidentLogKind,
  type ReportEvent,
  type SafeguardingReportStatus,
  type SafeguardingSeverity,
} from "./domain/report-status";
import { withLead, type LeadContext } from "./with-lead";

/** The most reports one page of the queue lists. */
export const QUEUE_LIMIT = 200;

/** Someone a lead sees by name: an assignee, a log entry's author. */
export type PersonRef = { id: string; name: string };

export type QueueItem = {
  id: string;
  reference: string;
  category: ConcernCategory;
  status: SafeguardingReportStatus;
  severity: SafeguardingSeverity | null;
  assignedTo: PersonRef | null;
  reporterIsChild: boolean;
  anonymous: boolean;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};

export type QueueView = "open" | "resolved";

export type ListSafeguardingReportsResult =
  | {
      ok: true;
      view: QueueView;
      reports: QueueItem[];
      /** More reports matched than the queue lists at once. */
      more: boolean;
    }
  | InvalidInput;

const listInput = z
  .strictObject({ view: z.enum(["open", "resolved"]).optional() })
  .optional();

const assignee = alias(user, "assignee");

/**
 * Open reports put new ones first (oldest first, so none waits unseen),
 * then the rest by severity and age; resolved ones list newest first.
 */
export async function listSafeguardingReports(
  ctx: LeadContext,
  input?: { view?: QueueView }
): Promise<ListSafeguardingReportsResult> {
  return withLead<ListSafeguardingReportsResult>(
    ctx,
    "safeguarding.list",
    async (tx) => {
      const parsed = listInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const view = parsed.data?.view ?? "open";

      const rows = await tx
        .select({
          id: safeguardingReport.id,
          reference: safeguardingReport.reference,
          category: safeguardingReport.category,
          status: safeguardingReport.status,
          severity: safeguardingReport.severity,
          assigneeId: assignee.id,
          assigneeName: assignee.name,
          reporterIsChild: safeguardingReport.reporterIsChild,
          anonymous: safeguardingReport.anonymous,
          createdAt: safeguardingReport.createdAt,
          updatedAt: safeguardingReport.updatedAt,
          resolvedAt: safeguardingReport.resolvedAt,
        })
        .from(safeguardingReport)
        .leftJoin(
          assignee,
          eq(assignee.id, safeguardingReport.assignedToUserId)
        )
        .where(
          view === "open"
            ? ne(safeguardingReport.status, "resolved")
            : eq(safeguardingReport.status, "resolved")
        )
        .orderBy(
          ...(view === "open"
            ? [
                desc(sql`${safeguardingReport.status} = 'new'`),
                asc(safeguardingReport.severity),
                asc(safeguardingReport.createdAt),
              ]
            : [desc(safeguardingReport.resolvedAt)]),
          asc(safeguardingReport.id)
        )
        .limit(QUEUE_LIMIT + 1);

      const reports = rows
        .slice(0, QUEUE_LIMIT)
        .map(({ assigneeId, assigneeName, ...row }): QueueItem => ({
          ...row,
          assignedTo: personOf(assigneeId, assigneeName),
        }));
      return {
        result: { ok: true, view, reports, more: rows.length > QUEUE_LIMIT },
        audit: {
          action: "safeguarding.queue_viewed",
          entity: { type: "safeguarding_queue", id: view },
          before: null,
          after: queueViewAuditSnapshot(reports.length),
        },
      };
    }
  );
}

export type IncidentLogEntryView = {
  id: string;
  kind: IncidentLogKind;
  toStatus: SafeguardingReportStatus | null;
  severity: SafeguardingSeverity | null;
  body: string | null;
  author: PersonRef | null;
  createdAt: Date;
};

export type SafeguardingReportView = {
  id: string;
  reference: string;
  category: ConcernCategory;
  description: string;
  subjectDetails: string | null;
  subjectAge: number | null;
  reporterIsChild: boolean;
  anonymous: boolean;
  reporterName: string | null;
  reporterContact: string | null;
  status: SafeguardingReportStatus;
  severity: SafeguardingSeverity | null;
  assignedTo: PersonRef | null;
  escalationReference: string | null;
  outcome: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  /** What the lead may do next, in the transition table's order. */
  allowedEvents: ReportEvent[];
  /** Oldest first. */
  log: IncidentLogEntryView[];
  /** Who the report can be assigned to: every safeguarding lead. */
  leads: PersonRef[];
};

export type ViewSafeguardingReportResult =
  | { ok: true; report: SafeguardingReportView }
  | InvalidInput
  | { ok: false; error: "not_found" };

export const reportIdInput = z.strictObject({ reportId: z.uuid() });

const author = alias(user, "author");

/** One report as the lead reads it. */
export async function viewSafeguardingReport(
  ctx: LeadContext,
  input: { reportId: string }
): Promise<ViewSafeguardingReportResult> {
  return withLead<ViewSafeguardingReportResult>(
    ctx,
    "safeguarding.view",
    async (tx) => {
      const parsed = reportIdInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const { reportId } = parsed.data;

      const [row] = await tx
        .select({
          report: safeguardingReport,
          assigneeId: assignee.id,
          assigneeName: assignee.name,
        })
        .from(safeguardingReport)
        .leftJoin(
          assignee,
          eq(assignee.id, safeguardingReport.assignedToUserId)
        )
        .where(eq(safeguardingReport.id, reportId));
      if (!row) return { result: { ok: false, error: "not_found" } as const };
      const { report } = row;

      const entries = await tx
        .select({
          entry: safeguardingIncidentLog,
          authorId: author.id,
          authorName: author.name,
        })
        .from(safeguardingIncidentLog)
        .leftJoin(author, eq(author.id, safeguardingIncidentLog.authorUserId))
        .where(eq(safeguardingIncidentLog.reportId, reportId))
        .orderBy(
          asc(safeguardingIncidentLog.createdAt),
          asc(safeguardingIncidentLog.id)
        );

      const { cipher } = ctx;
      const view: SafeguardingReportView = {
        id: report.id,
        reference: report.reference,
        category: report.category,
        description: open(cipher, "description", report.description),
        subjectDetails: openOrNull(
          cipher,
          "subjectDetails",
          report.subjectDetails
        ),
        subjectAge: report.subjectAge,
        reporterIsChild: report.reporterIsChild,
        anonymous: report.anonymous,
        reporterName: openOrNull(cipher, "reporterName", report.reporterName),
        reporterContact: openOrNull(
          cipher,
          "reporterContact",
          report.reporterContact
        ),
        status: report.status,
        severity: report.severity,
        assignedTo: personOf(row.assigneeId, row.assigneeName),
        escalationReference: openOrNull(
          cipher,
          "escalationReference",
          report.escalationReference
        ),
        outcome: openOrNull(cipher, "outcome", report.outcome),
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
        resolvedAt: report.resolvedAt,
        allowedEvents: allowedReportEvents(report.status),
        log: entries.map(
          ({ entry, authorId, authorName }): IncidentLogEntryView => ({
            id: entry.id,
            kind: entry.kind,
            toStatus: entry.toStatus,
            severity: entry.severity,
            body: openOrNull(cipher, "logBody", entry.body),
            author: personOf(authorId, authorName),
            createdAt: entry.createdAt,
          })
        ),
        leads: await safeguardingLeads(tx),
      };
      const snapshot = safeguardingReportAuditSnapshot(report);
      return {
        result: { ok: true, report: view },
        audit: {
          action: "safeguarding.report_viewed",
          entity: { type: "safeguarding_report", id: report.id },
          before: snapshot,
          after: snapshot,
        },
      };
    }
  );
}

/** Every user holding the global safeguarding lead role, by name. */
export async function safeguardingLeads(db: AppDb): Promise<PersonRef[]> {
  return db
    .selectDistinct({ id: user.id, name: user.name })
    .from(userRole)
    .innerJoin(user, eq(user.id, userRole.userId))
    .where(
      and(
        eq(userRole.role, "safeguarding_lead"),
        eq(userRole.scopeType, "global")
      )
    )
    .orderBy(asc(user.name), asc(user.id));
}

function personOf(id: string | null, name: string | null): PersonRef | null {
  return id === null || name === null ? null : { id, name };
}
