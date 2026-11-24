// The safeguarding module owns the retention date for each report, and the
// breach log for each breach (#116). The sweep checks the relevant user
// holds before deleting a report with its incident log, or a breach with
// its timeline, notices and unreachable list (ON DELETE CASCADE).

import { and, asc, eq, gt, inArray, isNotNull, lte } from "drizzle-orm";

import {
  breachRecord,
  breachTimelineEvent,
  safeguardingIncidentLog,
  safeguardingReport,
} from "../../../db/schema";
import {
  BREACH_RETENTION_POLICY,
  YEARS_AFTER_CLOSE,
} from "../../breaches/retention-policy";
import { SAFEGUARDING_RETENTION_POLICY } from "../../safeguarding/retention-policy";
import { nextCursor, type RetentionPolicy } from "./types";

export const SAFEGUARDING_REPORTS: RetentionPolicy = {
  key: SAFEGUARDING_RETENTION_POLICY.key,
  table: "safeguarding_report",
  action: SAFEGUARDING_RETENTION_POLICY.action,
  period: { kind: "fixed" },
  async candidates(db, query) {
    // The leads' actions also lock the report before writing incident entries.
    const { reports, next: nextId } =
      await SAFEGUARDING_RETENTION_POLICY.candidates(db, {
        ...query,
        after: query.after?.id ?? null,
      });
    const next = nextId === null ? null : { id: nextId };
    if (reports.length === 0) return { candidates: [], next };
    const authors = await db
      .selectDistinct({
        reportId: safeguardingIncidentLog.reportId,
        userId: safeguardingIncidentLog.authorUserId,
      })
      .from(safeguardingIncidentLog)
      .where(
        and(
          inArray(
            safeguardingIncidentLog.reportId,
            reports.map(({ id }) => id)
          ),
          isNotNull(safeguardingIncidentLog.authorUserId)
        )
      );
    const usersByReport = new Map<string, Set<string>>();
    for (const { reportId, userId } of authors) {
      if (userId === null) continue;
      const users = usersByReport.get(reportId) ?? new Set<string>();
      users.add(userId);
      usersByReport.set(reportId, users);
    }
    const candidates = reports.map(({ id, assignee, anchor }) => {
      const users = usersByReport.get(id) ?? new Set<string>();
      if (assignee !== null) users.add(assignee);
      return {
        id,
        anchor,
        subjects: [...users].map((id) => ({ type: "user", id })),
      };
    });
    return { candidates, next };
  },
  async apply(db, ids) {
    if (ids.length > 0) {
      await db
        .delete(safeguardingReport)
        .where(inArray(safeguardingReport.id, [...ids]));
    }
  },
};

export const BREACH_RECORDS: RetentionPolicy = {
  key: BREACH_RETENTION_POLICY.key,
  table: "breach_record",
  action: BREACH_RETENTION_POLICY.action,
  period: { kind: "fixed" },
  async candidates(db, { now, after, limit }) {
    // A closed breach goes on its fifth UTC anniversary of closing; scan
    // those closed before the cutoff in id order, locking each breach.
    const closedBy = new Date(now.getTime());
    closedBy.setUTCFullYear(closedBy.getUTCFullYear() - YEARS_AFTER_CLOSE);
    const rows = await db
      .select({
        id: breachRecord.id,
        closedAt: breachRecord.closedAt,
        lead: breachRecord.leadUserId,
      })
      .from(breachRecord)
      .where(
        and(
          eq(breachRecord.status, "closed"),
          lte(breachRecord.closedAt, closedBy),
          after === null ? undefined : gt(breachRecord.id, after.id)
        )
      )
      .orderBy(asc(breachRecord.id))
      .limit(limit)
      .for("update");
    const due = rows.flatMap(({ id, closedAt, lead }) => {
      if (closedAt === null) return [];
      const anchor = new Date(closedAt);
      anchor.setUTCFullYear(anchor.getUTCFullYear() + YEARS_AFTER_CLOSE);
      return anchor <= now ? [{ id, lead, anchor }] : [];
    });
    const next = nextCursor(rows, limit);
    if (due.length === 0) return { candidates: [], next };
    const authors = await db
      .selectDistinct({
        breachId: breachTimelineEvent.breachId,
        userId: breachTimelineEvent.authorUserId,
      })
      .from(breachTimelineEvent)
      .where(
        and(
          inArray(
            breachTimelineEvent.breachId,
            due.map(({ id }) => id)
          ),
          isNotNull(breachTimelineEvent.authorUserId)
        )
      );
    const candidates = due.map(({ id, lead, anchor }) => {
      const users = new Set<string>();
      if (lead !== null) users.add(lead);
      for (const author of authors) {
        if (author.breachId === id && author.userId !== null) {
          users.add(author.userId);
        }
      }
      return {
        id,
        anchor,
        subjects: [...users].map((id) => ({ type: "user", id })),
      };
    });
    return { candidates, next };
  },
  async apply(db, ids) {
    if (ids.length > 0) {
      await db.delete(breachRecord).where(inArray(breachRecord.id, [...ids]));
    }
  },
};
