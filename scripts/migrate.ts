// Applies the SQL migrations in ./drizzle. Runs in `vercel-build`, in the
// Docker `migrate` target and by hand (`pnpm db:migrate`).
//
// Migrations connect through DIRECT_URL only (SPEC §2.2): a direct or
// session-mode connection. DATABASE_URL may point at the transaction-mode
// pooler, so it is never a fallback.

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { migrationEnvSchema, parseEnv } from "../src/env.schema";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

let url: string;
try {
  url = parseEnv(migrationEnvSchema, process.env).DIRECT_URL;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
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
