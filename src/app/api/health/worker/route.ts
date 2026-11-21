import { connection } from "next/server";

import { env } from "@/env";
import { db } from "@/server/db";
import { workerHealthResponse } from "@/server/observability/worker-health";
import { systemClock } from "@/server/ports/clock";

// Health check for the VPS worker that serves this deployment's database
// (#66). 200 while its newest heartbeat is at most 120 s old, 503 `stale`
// or `missing` otherwise (src/server/observability/worker-health.ts).
// Apart from /api/health, so an uptime monitor tells a stalled worker from
// an app that is down (docker/README.md, "Monitoring and alerts").

export async function GET() {
  // Waits for a real request, so `next build` never runs the query.
  await connection();
  return workerHealthResponse({ db, clock: systemClock }, env().APP_ENV);
}
