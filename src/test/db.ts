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

/**
 * Creates a fresh in-memory Postgres (PGlite) database for a test and applies
 * the real migrations from ./drizzle, so tests and production share one
 * schema. Every call returns a new, isolated database.
 *
 * Code under test imports `db` from "@/server/db". Swap it with `vi.mock`.
 * The factory is hoisted, so keep the instance in a variable:
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
  // Extensions created by migrations must be loaded into PGlite up front.
  const client = new PGlite({ extensions: { pg_trgm } });
  const testDb = drizzle({ client, schema });
  await migrate(testDb, { migrationsFolder });
  return testDb;
}
