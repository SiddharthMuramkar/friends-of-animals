// Applies the SQL migrations in ./drizzle. Runs in `vercel-build`, in the
// Docker `migrate` target and by hand (`pnpm db:migrate`).
//
// Migrations need a direct (or session-mode) connection, so DIRECT_URL wins
// over DATABASE_URL, which may point at a transaction-mode pooler. Empty
// values count as unset.

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { loadEnvFiles } from "./load-env";

loadEnvFiles();

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DIRECT_URL or DATABASE_URL to run migrations.");
  process.exit(1);
}

// onnotice: silence "already exists, skipping" notices on every re-run.
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  console.log("Running migrations...");
  await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
  console.log("Migrations complete.");
  await client.end();
} catch (error) {
  console.error("Migration failed:", error);
  await client.end({ timeout: 5 });
  process.exit(1);
}
