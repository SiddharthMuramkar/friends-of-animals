// Seam 1 helpers for the safeguarding tests (#116). Test-only: imports
// nothing from Vitest, and production code never imports it.

import { asc, like, sql } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import { auditLog } from "@/server/db/schema";
import {
  ensureSafeguardingReport,
  type ReportSeed,
} from "@/server/seed/safeguarding";
import type { Harness } from "@/test/harness";

import type { Concern } from "./domain/concern";

let reports = 0;

/** A concern full of words a leak test can look for. */
export const CONCERN: Concern = {
  category: "suspected_abuse",
  description: "Tangerine umbrella description of the worry",
  subjectDetails: "Marmalade subject at Quokka school",
  subjectAge: 11,
  reporterIsChild: false,
  anonymous: false,
  reporterName: "Pelican Reporter",
  reporterContact: "pelican@example.test",
};

/** Words from CONCERN that must never appear outside the encrypted columns. */
export const CONCERN_WORDS = [
  "Tangerine",
  "Marmalade",
  "Quokka",
  "Pelican",
  "pelican@example.test",
];

/**
 * Stores a report directly, `new` as the form would have, or with
 * `state` (a status and the fields that status needs).
 */
export async function fileReport(
  h: Harness,
  concern: Concern = CONCERN,
  state: Omit<ReportSeed, "id" | "reference" | "concern" | "createdAt"> = {}
): Promise<string> {
  reports += 1;
  const id = `01938a00-0000-7000-8000-${String(reports).padStart(12, "0")}`;
  await ensureSafeguardingReport(h.deps, {
    id,
    reference: `SG-26-TEST${String(reports % 100).padStart(2, "0")}`,
    concern,
    createdAt: h.clock.now(),
    ...state,
  });
  return id;
}

/** A signed-in user holding the global safeguarding lead role. */
export async function signInLead(
  h: Harness,
  details: { name?: string; email?: string } = {}
): Promise<{ actor: Actor; id: string }> {
  const lead = await h.seed.member(details);
  await h.seed.grant(lead, {
    role: "safeguarding_lead",
    scope: { type: "global" },
  });
  return { actor: await h.signIn(lead), id: lead.id };
}

/** Every safeguarding audit row, oldest first. */
export async function safeguardingAuditRows(h: Harness) {
  return h.db
    .select()
    .from(auditLog)
    .where(like(auditLog.action, "safeguarding.%"))
    .orderBy(asc(auditLog.id));
}

/** Every row of `table` as JSON text, the way a raw dump would show it. */
export async function dumpTable(h: Harness, table: string): Promise<string> {
  const result = await h.db.execute<{ row: string }>(
    sql`SELECT row_to_json(t)::text AS row FROM ${sql.identifier(table)} t`
  );
  return result.rows.map((row) => row.row).join("\n");
}
