import { sql } from "drizzle-orm";

import { appEnv } from "@/lib/site";
import type { AppDb } from "@/server/db/app-db";
import {
  missingOrgFacts,
  type OrgFacts,
} from "@/server/modules/cms/domain/org-facts";

// The answer GET /api/health gives uptime monitors: the app and its
// database. The worker has its own check, GET /api/health/worker, so a
// stalled worker never pages as "the app is down".
//
// In production it also says whether FOA's organisation facts are all
// entered (#111), without naming the missing ones: this answer is public,
// and staff see the list in the admin shell.

/** Monitors and CDNs must never see a cached answer. */
const headers = { "Cache-Control": "no-store" };

type FactsReadiness = { facts?: "complete" | "incomplete" | "unknown" };

async function factsReadiness(
  orgFacts: (() => Promise<OrgFacts>) | undefined
): Promise<FactsReadiness> {
  if (!orgFacts || appEnv() !== "production") return {};
  try {
    const missing = missingOrgFacts(await orgFacts());
    return { facts: missing.length > 0 ? "incomplete" : "complete" };
  } catch (error) {
    console.error("Health check: the organisation facts read failed.", error);
    return { facts: "unknown" };
  }
}

/**
 * 200 with how long `select 1` took on `db`, or 503 when the query fails.
 * The route passes the app's database and facts; tests pass a PGlite
 * database and the facts they set.
 */
export async function healthResponse({
  db,
  orgFacts,
}: {
  db: AppDb;
  orgFacts?: () => Promise<OrgFacts>;
}): Promise<Response> {
  const started = performance.now();
  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    // The details stay in the server logs; the response doesn't leak them.
    console.error("Health check: the database query failed.", error);
    return Response.json(
      { status: "error", db: { ok: false } },
      { status: 503, headers }
    );
  }
  const ms = Math.round(performance.now() - started);
  return Response.json(
    { status: "ok", db: { ok: true, ms }, ...(await factsReadiness(orgFacts)) },
    { headers }
  );
}
