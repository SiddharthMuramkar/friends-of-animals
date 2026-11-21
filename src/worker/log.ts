// The worker's log: one JSON object per line on stdout, which Docker's
// json-file driver keeps (`docker compose -f docker/workers.yml logs`).
// Entries name databases and counts, never personal data.
//
// Loads under plain Node: no "server-only", no Next imports.

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

/** Stub. */
export function summarizeError(_error: unknown): string {
  return "";
}
