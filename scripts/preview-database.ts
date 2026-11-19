// Creates a preview's own database on pg-nonprod from the `foa_seed`
// template. scripts/migrate.ts runs it before migrating a
// preview. Kept apart from that script so it can be tested without Postgres.

import type { PreviewDatabase } from "../src/server/db/database-url";

/** The template every preview database is copied from. */
export const SEED_TEMPLATE = "foa_seed";

/** Runs one SQL statement, e.g. `(query) => sql.unsafe(query)`. */
export type RunSql = (query: string) => Promise<unknown>;

export type CreateOptions = {
  /** Attempts while the template is in use (55006), the first included. */
  attempts?: number;
  /** Milliseconds to wait before attempt `n + 1`. */
  backoff?: (n: number) => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

// SQLSTATEs from CREATE DATABASE.
/** The database exists already. */
const DUPLICATE_DATABASE = "42P04";
/** Another build created the same database at the same moment. */
const UNIQUE_VIOLATION = "23505";
/** Someone is connected to the template, which must have no sessions. */
const OBJECT_IN_USE = "55006";

/**
 * Creates `database` from `foa_seed` unless it exists, then sets its comment,
 * which the VPS sweeper reads. "Already exists" counts as success, including
 * a race with another build of the same branch. While the template is in use
 * it tries again, waiting longer each time (1 s, 2 s, 4 s, ...). Returns
 * whether it made the database.
 */
export async function createPreviewDatabase(
  run: RunSql,
  { name, comment }: PreviewDatabase,
  {
    attempts = 5,
    backoff = (n) => 1000 * 2 ** (n - 1),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console.log,
  }: CreateOptions = {}
): Promise<"created" | "exists"> {
  const database = quoteIdentifier(name);
  let outcome: "created" | "exists" | undefined;
  for (let attempt = 1; outcome === undefined; attempt++) {
    try {
      await run(
        `CREATE DATABASE ${database} TEMPLATE ${quoteIdentifier(SEED_TEMPLATE)}`
      );
      outcome = "created";
    } catch (error) {
      const code = sqlState(error);
      if (code === DUPLICATE_DATABASE || code === UNIQUE_VIOLATION) {
        outcome = "exists";
      } else if (code === OBJECT_IN_USE && attempt < attempts) {
        const wait = backoff(attempt);
        log(
          `Template ${SEED_TEMPLATE} is in use; trying again in ` +
            `${wait / 1000} s (attempt ${attempt + 1} of ${attempts}).`
        );
        await sleep(wait);
      } else {
        throw error;
      }
    }
  }
  log(
    outcome === "created"
      ? `Created preview database ${name} from ${SEED_TEMPLATE}.`
      : `Preview database ${name} exists; keeping it.`
  );
  await run(`COMMENT ON DATABASE ${database} IS ${quoteLiteral(comment)}`);
  log(`Commented ${name}: ${comment}`);
  return outcome;
}

/** A quoted SQL identifier: `"name"`, with any `"` doubled. */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * A quoted SQL string literal: `'text'`, with any `'` doubled. Postgres reads
 * backslashes literally (standard_conforming_strings, on since 9.1), so
 * nothing else needs escaping. A git branch may contain `'`.
 */
export function quoteLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function sqlState(error: unknown): string | undefined {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
