import type { DbWithClock } from "@/server/db/app-db";
import { readWorkerHealth } from "@/server/observability/worker-health";

// The answer GET /api/health/worker gives uptime monitors, from the
// worker's freshest heartbeat (src/server/observability/worker-health.ts).

/** Monitors and CDNs must never see a cached answer. */
const headers = { "Cache-Control": "no-store" };

/**
 * 200 while `environment`'s worker is ok, 503 when it is stale or missing,
 * and 503 `{ status: "error" }` when the database can't be read. The
 * error's details go to the server log only. The route passes the app's
 * database and clock; tests pass a harness's.
 */
export async function workerHealthResponse(
  deps: DbWithClock,
  environment: string
): Promise<Response> {
  try {
    const health = await readWorkerHealth(deps, environment);
    return Response.json(health, {
      status: health.status === "ok" ? 200 : 503,
      headers,
    });
  } catch (error) {
    console.error("Worker health check: the database query failed.", error);
    return Response.json({ status: "error" }, { status: 503, headers });
  }
}
