// Applies the SQL migrations in ./drizzle. Runs in `vercel-build`, in the
// Docker `migrate` target and by hand (`pnpm db:migrate`).
//
// Migrations connect through DIRECT_URL only (SPEC §2.2): a direct or
// session-mode connection. DATABASE_URL may point at the transaction-mode
// pooler, so it is never a fallback. On Vercel, DIRECT_URL logs in as a
// migrator role, which PgBouncer gives session mode, so the advisory lock
// below holds for the whole run.
//
// On a preview (APP_ENV=preview) it first creates the preview's own database
// from the `foa_seed` template, then migrates that database (SPEC §2.4).

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  migrationEnvSchema,
  parseEnv,
  type MigrationEnv,
} from "../src/env.schema";
import { directTls, withDatabase } from "../src/server/db/database-url";
import { loadEnvFiles } from "./load-env";
import { createPreviewDatabase, migrationTarget } from "./preview-database";

/**
 * Key of the session-level advisory lock held around `migrate()`: the ASCII
 * bytes of "FOA_MIGR" (0x464F415F4D494752) read as a bigint. Drizzle's
 * migrator takes no lock, and Vercel runs builds of one branch at the same
 * time, so without it two builds could apply the same migration twice.
 * Advisory locks belong to one database, so previews don't wait for each
 * other.
 */
const MIGRATION_LOCK_KEY = "5066339983389443922";

/** The connection options both clients share. */
function clientOptions(url: string) {
  return {
    ...directTls(url),
    max: 1,
    prepare: false,
    // Never retire the one connection mid-run: the lock lives on it.
    max_lifetime: null,
    connect_timeout: 10,
    // Silence "already exists, skipping" notices on every re-run.
    onnotice: () => {},
  };
}

loadEnvFiles();

let config: MigrationEnv;
try {
  config = parseEnv(migrationEnvSchema, process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// A preview migrates its own database, named once here: the same name is
// created below and then connected to. Staging and production migrate the
// database DIRECT_URL names (foa_staging, foa) in place.
const { url, create: preview } = migrationTarget(config);

if (preview !== undefined) {
  // CREATE DATABASE runs from another database: `postgres`, on the same
  // cluster, which PgBouncer reaches through its `*` entry.
  const maintenanceUrl = withDatabase(config.DIRECT_URL, "postgres");
  const admin = postgres(maintenanceUrl, clientOptions(maintenanceUrl));
  try {
    await createPreviewDatabase((query) => admin.unsafe(query), preview);
    await admin.end();
  } catch (error) {
    console.error(
      `Could not create the preview database ${preview.name}:`,
      error
    );
    await admin.end({ timeout: 5 });
    process.exit(1);
  }
}

const client = postgres(url, clientOptions(url));

try {
  await withMigrationLock(client, async () => {
    console.log(`Running migrations on ${new URL(url).pathname.slice(1)}...`);
    await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
    console.log("Migrations complete.");
  });
  await client.end();
} catch (error) {
  console.error("Migration failed:", error);
  await client.end({ timeout: 5 });
  process.exit(1);
}

/**
 * Runs `work` while holding the migration lock on the client's one
 * connection. A second migrator waits here until the first is done, then
 * finds nothing left to apply.
 */
async function withMigrationLock(sql: postgres.Sql, work: () => Promise<void>) {
  const [row] = await sql<[{ locked: boolean }]>`
    select pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) as locked
  `;
  if (!row?.locked) {
    console.log(
      "Waiting for the migration lock: another migration is running on " +
        "this database..."
    );
    const started = performance.now();
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`Got the migration lock after ${seconds} s.`);
  }
  try {
    await work();
  } finally {
    // Closing the session would release it too: Postgres drops a session's
    // advisory locks when it ends, and PgBouncer's reset (DISCARD ALL) does
    // when a session-mode client leaves.
    try {
      const [unlock] = await sql<[{ unlocked: boolean }]>`
        select pg_advisory_unlock(${MIGRATION_LOCK_KEY}) as unlocked
      `;
      if (!unlock?.unlocked) {
        console.warn(
          "The migration lock was already gone: the connection dropped and " +
            "reconnected while migrating."
        );
      }
    } catch (error) {
      console.warn("Could not release the migration lock:", error);
    }
  }
}
