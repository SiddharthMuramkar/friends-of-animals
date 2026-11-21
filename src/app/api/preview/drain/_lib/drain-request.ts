import type { Env } from "@/env.schema";
import type { DrainReport, OutboxDeps } from "@/server/outbox";

export type DrainRequest = {
  appEnv: Env["APP_ENV"];
  configuredToken: string | undefined;
  providedToken: string | null;
};

export type DrainResponse =
  | { status: 200; body: DrainReport }
  | { status: 401 | 404 };

export async function drainRequest(
  _deps: OutboxDeps,
  _request: DrainRequest
): Promise<DrainResponse> {
  return { status: 404 };
}
