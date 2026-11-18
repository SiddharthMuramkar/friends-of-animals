import { existsSync } from "node:fs";

/**
 * Loads .env.local and .env into process.env for scripts and drizzle-kit,
 * which run outside Next.js. Variables that are already set win, then
 * .env.local, then .env.
 */
export function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
