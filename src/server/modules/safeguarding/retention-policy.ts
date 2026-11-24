// Safeguarding's retention policy (#116): which reports #114's daily sweep
// may delete. The period is the safeguarding default in
// ./domain/retention.ts, which FOA's counsel still has to confirm (HR-31).
// Each personal-data column of a report and its incident log is listed,
// with that period, in the platform's data inventory
// (src/server/modules/privacy/inventory.ts).
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, asc, eq, gt, lte } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { safeguardingReport } from "../../db/schema";
import {
  reportRetainedUntil,
  YEARS_AFTER_RESOLUTION,
} from "./domain/retention";

/** The policy #114's engine registers: delete whole reports, log and all. */
export const SAFEGUARDING_RETENTION_POLICY = {
  key: "safeguardingReports",
  action: "delete",
  candidates: safeguardingRetentionPage,
} as const;

/**
 * Scan resolved reports in id order, locking each report before computing
 * its retention date. The cursor includes reports the child's age protects.
 */
export async function safeguardingRetentionPage(
  db: AppDb,
  { now, after, limit }: { now: Date; after: string | null; limit: number }
) {
  // No report can go before 7 years after its resolution; check the
  // child's age rule only on those.
  const resolvedBefore = new Date(now.getTime());
  resolvedBefore.setUTCFullYear(
    resolvedBefore.getUTCFullYear() - YEARS_AFTER_RESOLUTION
  );
  const rows = await db
    .select({
      id: safeguardingReport.id,
      assignee: safeguardingReport.assignedToUserId,
      reportedAt: safeguardingReport.createdAt,
      resolvedAt: safeguardingReport.resolvedAt,
      subjectAge: safeguardingReport.subjectAge,
    })
    .from(safeguardingReport)
    .where(
      and(
        eq(safeguardingReport.status, "resolved"),
        lte(safeguardingReport.resolvedAt, resolvedBefore),
        after === null ? undefined : gt(safeguardingReport.id, after)
      )
    )
    .orderBy(asc(safeguardingReport.id))
    .limit(limit)
    .for("update");
  const reports = rows.flatMap((row) => {
    const anchor = reportRetainedUntil(row);
    return anchor !== null && anchor <= now
      ? [{ id: row.id, assignee: row.assignee, anchor }]
      : [];
  });
  return {
    reports,
    next: rows.length === limit ? (rows.at(-1)?.id ?? null) : null,
  };
}
