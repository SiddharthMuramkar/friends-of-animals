import { sql } from "drizzle-orm";

import type { AppDb } from "@/server/db/app-db";

// The answer GET /api/health gives uptime monitors: the app and its
// database. The worker has its own check, GET /api/health/worker, so a
// stalled worker never pages as "the app is down".

/** Monitors and CDNs must never see a cached answer. */
const headers = { "Cache-Control": "no-store" };

/**
 * 200 with how long `select 1` took on `db`, or 503 when the query fails.
 * The route passes the app's database; tests pass a PGlite one.
 */
export async function healthResponse({ db }: { db: AppDb }): Promise<Response> {
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
  return Response.json({ status: "ok", db: { ok: true, ms } }, { headers });
}
