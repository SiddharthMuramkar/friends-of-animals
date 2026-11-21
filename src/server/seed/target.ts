// Which database `pnpm db:seed` fills, if any. Loads under plain Node.

import { migrationTarget, type DatabaseEnv } from "../db/database-url";

export type SeedTarget =
  | { seed: true; url: string }
  | { seed: false; reason: string };

/**
 * Hosts a local seed may connect to: this machine, or the `db` service of
 * docker-compose.yml.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "db"]);

/**
 * Previews and local runs are seeded, through DIRECT_URL, in the same
 * database the migration just ran on. Staging and production never are:
 * the command exits without touching them, so `vercel-build` can run it
 * everywhere.
 *
 * APP_ENV unset counts as local, so a local seed also needs a local host:
 * a hand-run `pnpm db:seed` with a deployed DIRECT_URL must not plant the
 * seed accounts in that database.
 */
export function seedTarget(
  env: DatabaseEnv & { DIRECT_URL: string }
): SeedTarget {
  const appEnv = env.APP_ENV ?? "local";
  if (appEnv !== "local" && appEnv !== "preview") {
    return {
      seed: false,
      reason: `APP_ENV=${appEnv}: seed data goes only into preview and local databases.`,
    };
  }
  const { url } = migrationTarget(env);
  if (appEnv === "local") {
    const host = new URL(url).hostname.toLowerCase();
    if (!LOCAL_HOSTS.has(host)) {
      return {
        seed: false,
        reason:
          `APP_ENV=local but DIRECT_URL points at ${host}: a local seed ` +
          `goes only into a database on this machine or the Compose db ` +
          `service (${[...LOCAL_HOSTS].join(", ")}).`,
      };
    }
  }
  return { seed: true, url };
}
