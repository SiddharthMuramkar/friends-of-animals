import type { NextRequest } from "next/server";

import { env } from "@/env";
import { productionDeps } from "@/server/deps";

import { drainRequest } from "./_lib/drain-request";

// Drains this deployment's outbox with this deployment's code, for the
// Seam 2 journeys: POST with the x-capture-mailbox-token header. Rules in
// ./_lib/drain-request.ts. A POST handler is never prerendered or cached.

const headers = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function POST(request: NextRequest) {
  const config = env();
  const result = await drainRequest(productionDeps(), {
    appEnv: config.APP_ENV,
    configuredToken: config.CAPTURE_MAILBOX_TOKEN,
    providedToken: request.headers.get("x-capture-mailbox-token"),
  });
  return result.status === 200
    ? Response.json(result.body, { headers })
    : new Response(null, { status: result.status, headers });
}
