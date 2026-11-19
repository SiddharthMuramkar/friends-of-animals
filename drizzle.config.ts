import { defineConfig } from "drizzle-kit";

import { migrationEnvSchema, parseEnv } from "./src/env.schema";
import { loadEnvFiles } from "./scripts/load-env";

loadEnvFiles();

// drizzle-kit connects like the migration script: through DIRECT_URL only,
// never DATABASE_URL.
const { DIRECT_URL } = parseEnv(migrationEnvSchema, process.env);

export default defineConfig({
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: DIRECT_URL },
});
