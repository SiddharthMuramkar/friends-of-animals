import { connection } from "next/server";

import { env } from "@/env";
import { db } from "@/server/db";
import { readWorkerHealth } from "@/server/ops/worker-health";
import { systemClock } from "@/server/ports/clock";

// Health check for the VPS worker that serves this deployment's database
// (#66). 200 while its newest heartbeat is at most 120 s old, 503 `stale`
// or `missing` otherwise. Apart from /api/health, so an uptime monitor
// tells a stalled worker from an app that is down (docker/README.md,
// "Monitoring and alerts").

/** Monitors and CDNs must never see a cached answer. */
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  // Waits for a real request, so `next build` never runs the query.
  await connection();

  try {
    const health = await readWorkerHealth(
      { db, clock: systemClock },
      env().APP_ENV
    );
    return Response.json(health, {
      status: health.status === "ok" ? 200 : 503,
      headers,
    });
  } catch (error) {
    // The details stay in the server logs; the response doesn't leak them.
    console.error("Worker health check: the database query failed.", error);
    return Response.json({ status: "error" }, { status: 503, headers });
  }
}
