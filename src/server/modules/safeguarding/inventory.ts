// Safeguarding's entries in the data inventory, and its retention policy
// (#116). Every column holding what someone typed about a child, or about
// themselves, is listed with its purpose and how long it is kept. The
// period is the safeguarding default in ./domain/retention.ts, which FOA's
// counsel still has to confirm (HR-31).
//
// The platform's inventory and retention engine (#73 creates the inventory
// file, #114 the policy registry and the daily sweep) have not landed on
// this branch yet: they spread SAFEGUARDING_INVENTORY into the inventory
// and register SAFEGUARDING_RETENTION_POLICY when they do.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, asc, eq, lte } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { safeguardingReport } from "../../db/schema";
import {
  reportRetainedUntil,
  YEARS_AFTER_RESOLUTION,
} from "./domain/retention";

/** #73's inventory entry, with the retention policy #114 adds. */
export type SafeguardingInventoryEntry = {
  table: "safeguarding_report" | "safeguarding_incident_log";
  column: string;
  purpose: string;
  retention: {
    period: string;
    basis: string;
    toConfirm: true;
    policy: "safeguardingReports";
  };
};

const RETENTION: SafeguardingInventoryEntry["retention"] = {
  period:
    "While the report is open, then 7 years after it is resolved or " +
    "until the child concerned turns 25, whichever is later",
  basis:
    "Child protection: the record of what was reported and done, kept " +
    "for the child, FOA and the authorities (legal basis to confirm)",
  toConfirm: true,
  policy: "safeguardingReports",
};

const report = (
  column: string,
  purpose: string
): SafeguardingInventoryEntry => ({
  table: "safeguarding_report",
  column,
  purpose,
  retention: RETENTION,
});

export const SAFEGUARDING_INVENTORY: readonly SafeguardingInventoryEntry[] = [
  report(
    "description",
    "What the reporter saw or was told, so the safeguarding lead can act"
  ),
  report(
    "subject_details",
    "Who the concern is about (a name, a school, a username), to find the child"
  ),
  report(
    "subject_age",
    "The child's rough age, to judge urgency and how long to keep the report"
  ),
  report(
    "reporter_name",
    "Who reported, when they chose not to stay anonymous, to follow up"
  ),
  report(
    "reporter_contact",
    "How to reach the reporter (email or phone), when they chose to be reached"
  ),
  report(
    "escalation_reference",
    "The outside authority's reference, to follow the case with them"
  ),
  report(
    "outcome",
    "What the safeguarding lead decided and did, as the record of the case"
  ),
  {
    table: "safeguarding_incident_log",
    column: "body",
    purpose:
      "The lead's notes and decisions over the case's life, as its record",
    retention: RETENTION,
  },
];

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
