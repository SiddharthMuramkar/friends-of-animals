import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { db } from "@/server/db";

// Health check for uptime monitors. Today it checks the database; the
// queue and worker heartbeat join it with the worker.

/** Monitors and CDNs must never see a cached answer. */
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  // With Cache Components a GET handler is prerendered when it can be. This
  // waits for a real request, so `next build` never runs the query.
  await connection();

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
