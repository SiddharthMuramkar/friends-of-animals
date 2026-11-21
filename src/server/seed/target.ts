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
 * The deployed servers' roles and databases (docker/README.md). A local
 * address can still reach them, through an admin's SSH tunnel or PgBouncer
 * on the database server, so a local seed refuses them by name.
 */
const DEPLOYED_ROLE = /^(postgres|foa_app|foa_migrator|staging_.+|nonprod_.+)$/;
const DEPLOYED_DATABASE = /^(foa_staging|foa_seed|foa_pr(_.+)?|foa_br(_.+)?)$/;

/**
 * Why the database client could connect to another host than `url` names,
 * or undefined. Messages start with "DIRECT_URL" and never quote the URL.
 */
export function hostInDoubt(url: string): string | undefined {
  // postgres-js ends the authority at the first "/" or "?" and splits it at
  // the last "@", ignoring "#"; the WHATWG parser below ends it at "#". So
  // "…@localhost#@remote/…" would pass this check and connect to remote.
  // Refuse anything the two could read differently.
  const authority = url.slice(url.indexOf("://") + 3).split(/[/?]/)[0] ?? "";
  if (url.includes("#") || authority.split("@").length > 2) {
    return (
      `DIRECT_URL has "#" or more than one "@" before ` +
      `its path, so the database client could connect to another host ` +
      `than this check sees.`
    );
  }
  // postgres-js connects to a host named in the query over the URL's own.
  for (const param of ["host", "hostaddr"]) {
    if (new URL(url).searchParams.has(param)) {
      return `DIRECT_URL names a host in ?${param}=: the host must come from the URL alone.`;
    }
  }
  return undefined;
}

/**
 * Why `url` isn't a local database that `purpose` may use, or undefined if
 * it is. Messages start with "DIRECT_URL" and never quote credentials.
 */
export function notLocal(
  url: string,
  purpose = "a local seed"
): string | undefined {
  const doubt = hostInDoubt(url);
  if (doubt) return doubt;
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    return (
      `DIRECT_URL points at ${host}: ${purpose} ` +
      `goes only into a database on this machine or the Compose db ` +
      `service (${[...LOCAL_HOSTS].join(", ")}).`
    );
  }
  const role = decodeURIComponent(parsed.username);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (DEPLOYED_ROLE.test(role) || DEPLOYED_DATABASE.test(database)) {
    return (
      `DIRECT_URL uses the deployed role or database ` +
      `${role}@${database} (a tunnel?): ${purpose} uses the Compose ` +
      `login, foa@foa.`
    );
  }
  return undefined;
}

/**
 * Previews and local runs are seeded, through DIRECT_URL, in the same
 * database the migration just ran on. Staging and production never are:
 * the command exits without touching them, so `vercel-build` can run it
 * everywhere.
 *
 * APP_ENV unset counts as local, so a local seed also needs a local host
 * and a role and database that aren't the deployed ones: a hand-run
 * `pnpm db:seed` with a deployed DIRECT_URL must not plant the seed
 * accounts in that database.
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
  const refused = appEnv === "local" ? notLocal(url) : undefined;
  return refused
    ? { seed: false, reason: `APP_ENV=local but ${refused}` }
    : { seed: true, url };
}
