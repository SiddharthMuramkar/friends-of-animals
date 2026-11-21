// Draining the outbox over HTTP (POST /api/preview/drain), so a preview's
// Seam 2 journeys see the welcome email without waiting for the shared VPS
// worker, and with the PR's own handlers. It is:
//   - only on previews and local runs (404 on staging and production,
//     which have their own worker), and closed unless
//     CAPTURE_MAILBOX_TOKEN is set (404);
//   - only for the holder of that token (x-capture-mailbox-token, compared
//     in constant time; 401 otherwise): the same secret as the capture
//     mailbox, so no new one;
//   - never cached.

import type { Env } from "@/env.schema";
import { sameToken } from "@/server/mailbox/read-mailbox";
import {
  drainUntilIdle,
  type DrainReport,
  type OutboxDeps,
} from "@/server/outbox";

export type DrainRequest = {
  appEnv: Env["APP_ENV"];
  configuredToken: string | undefined;
  providedToken: string | null;
};

export type DrainResponse =
  | { status: 200; body: DrainReport }
  | { status: 401 | 404 };

export async function drainRequest(
  deps: OutboxDeps,
  { appEnv, configuredToken, providedToken }: DrainRequest
): Promise<DrainResponse> {
  if ((appEnv !== "preview" && appEnv !== "local") || !configuredToken) {
    return { status: 404 };
  }
  if (!providedToken || !sameToken(providedToken, configuredToken)) {
    return { status: 401 };
  }
  return { status: 200, body: await drainUntilIdle(deps) };
}
