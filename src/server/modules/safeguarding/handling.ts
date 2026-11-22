// What a safeguarding lead does with a report (#116).
//
//   moveSafeguardingReport({ reportId, action })        → triage, investigate,
//                                                         escalate or resolve
//   assignSafeguardingReport({ reportId, assigneeUserId }) → a lead, or nobody
//   addIncidentLogEntry({ reportId, body })             → a note
//
// Each locks the report's row, so two leads acting at once queue, and
// writes its audit row through `withLead`. A move follows the transition
// table (./domain/report-status.ts) and appends its incident log entry in
// the same transaction; a refused move writes nothing. Notes may be added
// to a resolved report: later facts belong in the log, not in an edit.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../../db/app-db";
import {
  safeguardingIncidentLog,
  safeguardingReport,
  userRole,
  type SafeguardingReportRow,
} from "../../db/schema";
import { monotonicUuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { seal } from "./content";
import {
  incidentLogEntryAuditSnapshot,
  safeguardingReportAuditSnapshot,
  type SafeguardingAuditAction,
} from "./domain/audit";
import {
  decideReportTransition,
  incidentLogKindFor,
  reportActionSchema,
  type ReportAction,
  type ReportEvent,
  type ReportTransitionRefusal,
  type SafeguardingReportStatus,
} from "./domain/report-status";
import { withLead, type LeadContext } from "./with-lead";

/** The audit action each move records. */
const MOVE_AUDIT_ACTIONS: Readonly<
  Record<ReportEvent, SafeguardingAuditAction>
> = {
  triage: "safeguarding.report_triaged",
  start_investigation: "safeguarding.investigation_started",
  escalate: "safeguarding.report_escalated",
  resolve: "safeguarding.report_resolved",
};

/**
 * Log entries written in one millisecond still list in the order they were
 * written (the log is read oldest first, by id within an instant).
 */
const nextEntryId = monotonicUuidv7();

/** The longest note a lead may write; stored encrypted. */
export const NOTE_MAX = 4000;

/** The report's row, locked until the transaction ends. */
async function lockReport(
  tx: AppDb,
  reportId: string
): Promise<SafeguardingReportRow | undefined> {
  const [row] = await tx
    .select()
    .from(safeguardingReport)
    .where(eq(safeguardingReport.id, reportId))
    .for("update");
  return row;
}

const NOT_FOUND = { ok: false, error: "not_found" } as const;

export type MoveSafeguardingReportResult =
  | { ok: true; status: SafeguardingReportStatus }
  | InvalidInput
  | { ok: false; error: ReportTransitionRefusal | "not_found" };

const moveInput = z.strictObject({
  reportId: z.uuid(),
  action: reportActionSchema,
});

/** Moves a report one step through the transition table. */
export async function moveSafeguardingReport(
  ctx: LeadContext,
  input: { reportId: string; action: ReportAction }
): Promise<MoveSafeguardingReportResult> {
  return withLead<MoveSafeguardingReportResult>(
    ctx,
    "safeguarding.transition",
    async (tx, lead) => {
      const parsed = moveInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const { reportId, action } = parsed.data;

      const report = await lockReport(tx, reportId);
      if (!report) return { result: NOT_FOUND };
      const decision = decideReportTransition({
        from: report.status,
        event: action.event,
      });
      if (!decision.ok) {
        return { result: { ok: false, error: decision.reason } as const };
      }

      const now = ctx.clock.now();
      const text =
        action.event === "escalate"
          ? action.authorityReference
          : action.event === "resolve"
            ? action.outcome
            : null;
      const [updated] = await tx
        .update(safeguardingReport)
        .set({
          status: decision.to,
          updatedAt: now,
          ...(action.event === "triage" ? { severity: action.severity } : {}),
          ...(action.event === "escalate"
            ? {
                escalationReference: seal(
                  ctx.cipher,
                  "escalationReference",
                  action.authorityReference
                ),
              }
            : {}),
          ...(action.event === "resolve"
            ? {
                outcome: seal(ctx.cipher, "outcome", action.outcome),
                resolvedAt: now,
              }
            : {}),
        })
        .where(eq(safeguardingReport.id, reportId))
        .returning();
      if (!updated) throw new Error(`Report ${reportId} vanished while locked`);

      await tx.insert(safeguardingIncidentLog).values({
        id: nextEntryId(now),
        reportId,
        kind: incidentLogKindFor(action.event),
        toStatus: decision.to,
        severity: action.event === "triage" ? action.severity : null,
        body: text === null ? null : seal(ctx.cipher, "logBody", text),
        authorUserId: lead.userId,
        createdAt: now,
      });

      return {
        result: { ok: true, status: decision.to } as const,
        audit: {
          action: MOVE_AUDIT_ACTIONS[action.event],
          entity: { type: "safeguarding_report", id: reportId },
          before: safeguardingReportAuditSnapshot(report),
          after: safeguardingReportAuditSnapshot(updated),
        },
      };
    }
  );
}

export type AssignSafeguardingReportResult =
  | { ok: true; changed: boolean }
  | InvalidInput
  | { ok: false; error: "not_found" | "assignee_not_lead" | "report_resolved" };

const assignInput = z.strictObject({
  reportId: z.uuid(),
  /** Null takes the report off whoever had it. */
  assigneeUserId: z.uuid().nullable(),
});

async function holdsLeadRole(tx: AppDb, userId: string): Promise<boolean> {
  const [grant] = await tx
    .select({ id: userRole.id })
    .from(userRole)
    .where(
      and(
        eq(userRole.userId, userId),
        eq(userRole.role, "safeguarding_lead"),
        eq(userRole.scopeType, "global")
      )
    );
  return grant !== undefined;
}

/**
 * Gives an open report to a safeguarding lead, or to nobody. Only a lead
 * may hold one; the same assignee again changes and records nothing.
 */
export async function assignSafeguardingReport(
  ctx: LeadContext,
  input: { reportId: string; assigneeUserId: string | null }
): Promise<AssignSafeguardingReportResult> {
  return withLead<AssignSafeguardingReportResult>(
    ctx,
    "safeguarding.assign",
    async (tx) => {
      const parsed = assignInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const { reportId, assigneeUserId } = parsed.data;

      const report = await lockReport(tx, reportId);
      if (!report) return { result: NOT_FOUND };
      if (report.status === "resolved") {
        return { result: { ok: false, error: "report_resolved" } as const };
      }
      if (report.assignedToUserId === assigneeUserId) {
        return { result: { ok: true, changed: false } as const };
      }
      if (
        assigneeUserId !== null &&
        !(await holdsLeadRole(tx, assigneeUserId))
      ) {
        return { result: { ok: false, error: "assignee_not_lead" } as const };
      }

      const [updated] = await tx
        .update(safeguardingReport)
        .set({ assignedToUserId: assigneeUserId, updatedAt: ctx.clock.now() })
        .where(eq(safeguardingReport.id, reportId))
        .returning();
      if (!updated) throw new Error(`Report ${reportId} vanished while locked`);
      return {
        result: { ok: true, changed: true } as const,
        audit: {
          action: "safeguarding.report_assigned",
          entity: { type: "safeguarding_report", id: reportId },
          before: safeguardingReportAuditSnapshot(report),
          after: safeguardingReportAuditSnapshot(updated),
        },
      };
    }
  );
}

export type AddIncidentLogEntryResult =
  | { ok: true; entryId: string }
  | InvalidInput
  | { ok: false; error: "not_found" };

const noteInput = z.strictObject({
  reportId: z.uuid(),
  body: z.string().trim().min(1).max(NOTE_MAX),
});

/** Appends a lead's note to the report's incident log. */
export async function addIncidentLogEntry(
  ctx: LeadContext,
  input: { reportId: string; body: string }
): Promise<AddIncidentLogEntryResult> {
  return withLead<AddIncidentLogEntryResult>(
    ctx,
    "safeguarding.add-note",
    async (tx, lead) => {
      const parsed = noteInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const { reportId, body } = parsed.data;

      const report = await lockReport(tx, reportId);
      if (!report) return { result: NOT_FOUND };

      const now = ctx.clock.now();
      const entry = { id: nextEntryId(now), kind: "note" } as const;
      await tx.insert(safeguardingIncidentLog).values({
        ...entry,
        reportId,
        body: seal(ctx.cipher, "logBody", body),
        authorUserId: lead.userId,
        createdAt: now,
      });
      return {
        result: { ok: true, entryId: entry.id } as const,
        audit: {
          action: "safeguarding.incident_log_entry_added",
          entity: { type: "safeguarding_report", id: reportId },
          before: null,
          after: incidentLogEntryAuditSnapshot(entry),
        },
      };
    }
  );
}
