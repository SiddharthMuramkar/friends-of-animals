import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "~/db/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

/**
 * Creates a fresh in-memory Postgres (PGlite) database for testing.
 * Each call returns a new isolated database instance.
 *
 * Runs the same Drizzle migrations as the live database, so test and
 * production schemas are always in sync.
 *
 * Injecting into code under test: services import `db` from "~/db", so swap
 * it out with `vi.mock`. The mock factory is hoisted, so hold the instance in
 * a mutable variable and recreate it per test:
 *
 *   import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
 *
 *   let testDb: TestDb;
 *   vi.mock("~/db", () => ({
 *     get db() {
 *       return testDb;
 *     },
 *   }));
 *
 *   beforeEach(async () => {
 *     testDb = await createTestDb();
 *     base = await seedBaseData(testDb);
 *   });
 */
export async function createTestDb() {
  const client = new PGlite();
  const testDb = drizzle(client, { schema });
  await migrate(testDb, { migrationsFolder });
  return testDb;
}

/**
 * Seeds a minimal set of base data (one user, two animals) that most tests
 * need. Returns the created rows for use in assertions.
 */
export async function seedBaseData(testDb: TestDb) {
  const [user] = await testDb
    .insert(schema.users)
    .values({
      name: "Test User",
      email: "test@example.com",
      role: schema.UserRole.Staff,
    })
    .returning();

  const [dog, cat] = await testDb
    .insert(schema.animals)
    .values([
      {
        name: "Rex",
        species: "dog",
        status: schema.AnimalStatus.Available,
      },
      {
        name: "Whiskers",
        species: "cat",
        status: schema.AnimalStatus.Pending,
      },
    ])
    .returning();

  return { user, dog, cat };
}
