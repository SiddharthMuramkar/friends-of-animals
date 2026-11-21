import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";

import * as schema from "@/server/db/schema";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
);

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

/** One migrated database per Vitest worker; every test gets a copy. */
let template: Promise<PGlite> | undefined;

async function migratedTemplate() {
  // Extensions created by migrations must be loaded into PGlite up front.
  // A clone keeps them.
  const client = new PGlite({ extensions: { pg_trgm } });
  await migrate(drizzle({ client }), { migrationsFolder });
  return client;
}

/**
 * Creates a fresh in-memory Postgres (PGlite) database for a test with the
 * real migrations from ./drizzle applied, so tests and production share one
 * schema. Every call returns a new, isolated database.
 *
 * The migrations run once per Vitest worker, into a template; each call
 * returns a clone of it (about 0.4 s, against 1.7 s and growing for a fresh
 * database).
 *
 * Use-case tests should use `createHarness()` from "@/test/harness", which
 * builds on this. Older code that imports `db` from "@/server/db" swaps it
 * with `vi.mock`. The factory is hoisted, so keep the instance in a variable:
 *
 *   import { createTestDb, type TestDb } from "@/test/db";
 *
 *   let testDb: TestDb;
 *   vi.mock("@/server/db", () => ({
 *     get db() {
 *       return testDb;
 *     },
 *   }));
 *
 *   beforeEach(async () => {
 *     testDb = await createTestDb();
 *   });
 */
export async function createTestDb() {
  template ??= migratedTemplate().catch((error: unknown) => {
    // Let the next test try again rather than fail on a stale rejection.
    template = undefined;
    throw error;
  });
  const client = await (await template).clone();
  if (!(client instanceof PGlite)) {
    throw new TypeError("PGlite.clone() did not return a PGlite instance");
  }
  return drizzle({ client, schema });
}
