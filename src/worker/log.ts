// The worker's log: one JSON object per line on stdout, which Docker's
// journald driver keeps for a year (`docker compose -f docker/workers.yml
// logs`; docker/README.md, "Logs").
// Entries name databases and counts, never personal data.
//
// Loads under plain Node: no "server-only", no Next imports.

import { errorSummaryForLogs } from "../server/errors";

export type WorkerLogEntry = {
  level: "info" | "error";
  /** What happened, e.g. tenant.attached or discovery.failed. */
  event: string;
  /** The database it concerns, if one. */
  database?: string;
  /** A failure's description, with personal data hidden. */
  error?: string;
  [field: string]: unknown;
};

export type WorkerLog = (entry: WorkerLogEntry) => void;

/** A Node system error code, such as ECONNREFUSED or ENOTFOUND. */
const SYSTEM_CODE = /^E[A-Z0-9_]+$/;

function systemCode(error: unknown): string | undefined {
  if (error instanceof AggregateError) {
    return error.errors.map(systemCode).find((code) => code !== undefined);
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  return typeof code === "string" && SYSTEM_CODE.test(code) ? code : undefined;
}

/**
 * What to log about a failure: its class and a Postgres or system error
 * code, never its message, which may hold query parameters (addresses).
 */
export function summarizeError(error: unknown): string {
  const code = systemCode(error);
  const summary = errorSummaryForLogs(error);
  return code === undefined ? summary : `${summary} (${code})`;
}
