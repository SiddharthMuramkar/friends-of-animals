import { connection } from "next/server";

import { env } from "@/env";
import { db } from "@/server/db";
import { systemClock } from "@/server/ports/clock";

import { workerHealthResponse } from "./_lib/worker-health-response";

// Health check for the VPS worker that serves this deployment's database
// (#66): 200 while its newest heartbeat is at most 120 s old, 503 `stale`
// or `missing` otherwise. Apart from /api/health, so an uptime monitor
// tells a stalled worker from an app that is down (docker/README.md,
// "Monitoring and alerts"). What it answers is in
// ./_lib/worker-health-response.ts, which takes the database and clock as
// arguments so tests can hand it theirs.

export async function GET() {
  // Waits for a real request, so `next build` never runs the query.
  await connection();
  return workerHealthResponse({ db, clock: systemClock }, env().APP_ENV);
}
