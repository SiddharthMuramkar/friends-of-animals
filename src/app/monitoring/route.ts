import { env } from "@/env";
import { handleTunnelRequest } from "@/server/observability/tunnel";

// The browser's Sentry tunnel (#66): src/instrumentation-client.ts sends
// its error envelopes here, and src/server/observability/tunnel.ts passes
// on the ones for our project, scrubbed. Answers 404 without a DSN.

export async function POST(request: Request): Promise<Response> {
  const { NEXT_PUBLIC_SENTRY_DSN, APP_ENV } = env();
  return handleTunnelRequest(request, {
    dsn: NEXT_PUBLIC_SENTRY_DSN,
    environment: APP_ENV,
  });
}
