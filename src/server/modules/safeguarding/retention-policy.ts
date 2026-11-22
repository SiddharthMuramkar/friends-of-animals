// Safeguarding's retention policy (#116): which reports #114's daily sweep
// may delete. The period is the safeguarding default in
// ./domain/retention.ts, which FOA's counsel still has to confirm (HR-31).
// Each personal-data column of a report and its incident log is listed,
// with that period, in the platform's data inventory
// (src/server/modules/privacy/inventory.ts).
//
// #114's policy registry and sweep aren't on main yet: it registers
// SAFEGUARDING_RETENTION_POLICY when it lands.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, asc, eq, lte } from "drizzle-orm";

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
  candidates: safeguardingRetentionCandidates,
} as const;

/**
 * Resolved reports whose retention date (./domain/retention.ts) has
 * passed at `now`, by id. Open reports are never picked. Deleting one
 * takes its incident log with it (ON DELETE CASCADE).
 */
export async function safeguardingRetentionCandidates(
  db: AppDb,
  now: Date
): Promise<string[]> {
  // No report can go before 7 years after its resolution; check the
  // child's age rule only on those.
  const resolvedBefore = new Date(now.getTime());
  resolvedBefore.setUTCFullYear(
    resolvedBefore.getUTCFullYear() - YEARS_AFTER_RESOLUTION
  );
  const rows = await db
    .select({
      id: safeguardingReport.id,
      reportedAt: safeguardingReport.createdAt,
      resolvedAt: safeguardingReport.resolvedAt,
      subjectAge: safeguardingReport.subjectAge,
    })
    .from(safeguardingReport)
    .where(
      and(
        eq(safeguardingReport.status, "resolved"),
        lte(safeguardingReport.resolvedAt, resolvedBefore)
      )
    )
    .orderBy(asc(safeguardingReport.id));
  return rows
    .filter((row) => {
      const until = reportRetainedUntil(row);
      return until !== null && until <= now;
    })
    .map((row) => row.id);
}
