// The breach log's retention policy (#116): which breach records #114's
// daily sweep may delete. A breach is kept while open and for 5 years
// after it is closed, so FOA can show the authority what it knew, did and
// told whom (a default FOA's counsel still has to confirm, HR-31). Each
// personal-data column of a breach, its timeline, its notices and who
// couldn't be reached is listed, with that period, in the platform's data
// inventory (src/server/modules/privacy/inventory.ts).
//
// #114's policy registry and sweep aren't on main yet: it registers
// BREACH_RETENTION_POLICY after it lands. The sweep must check legal holds
// before deleting, since the breach owns its timeline, notices, fan-out
// and unreachable list (ON DELETE CASCADE).
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, asc, eq, lte } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { breachRecord } from "../../db/schema";

/** How long a closed breach is kept (HR-31, to confirm). */
export const YEARS_AFTER_CLOSE = 5;

/** The policy #114's engine registers: delete whole breaches. */
export const BREACH_RETENTION_POLICY = {
  key: "breachRecords",
  action: "delete",
  candidates: breachRetentionCandidates,
} as const;

/**
 * Closed breaches at or past their fifth UTC anniversary, by id. A breach
 * closed on February 29 reaches that anniversary on March 1 at the same
 * UTC time in a non-leap year. Listing candidates leaves the records intact.
 */
export async function breachRetentionCandidates(
  db: AppDb,
  now: Date
): Promise<string[]> {
  const closedBy = new Date(now.getTime());
  closedBy.setUTCFullYear(closedBy.getUTCFullYear() - YEARS_AFTER_CLOSE);
  const rows = await db
    .select({ id: breachRecord.id, closedAt: breachRecord.closedAt })
    .from(breachRecord)
    .where(
      and(
        eq(breachRecord.status, "closed"),
        lte(breachRecord.closedAt, closedBy)
      )
    )
    .orderBy(asc(breachRecord.id));
  // The indexed cutoff can include part of March 1 during a leap-day sweep.
  // Compare each closure's actual anniversary to handle both leap boundaries.
  return rows.flatMap(({ id, closedAt }) => {
    if (closedAt === null) return [];
    const anniversary = new Date(closedAt);
    anniversary.setUTCFullYear(
      anniversary.getUTCFullYear() + YEARS_AFTER_CLOSE
    );
    return anniversary <= now ? [id] : [];
  });
}
