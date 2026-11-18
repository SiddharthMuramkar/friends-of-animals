import { defineConfig } from "drizzle-kit";

import { loadEnvFiles } from "./scripts/load-env";

loadEnvFiles();

// drizzle-kit talks to Postgres directly, so it prefers DIRECT_URL, the
// non-pooled connection. Empty values count as unset. The fallback matches
// the `db` service in docker-compose.yml.
export default defineConfig({
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DIRECT_URL ||
      process.env.DATABASE_URL ||
      "postgres://foa:foa@localhost:5432/foa",
  },
});
