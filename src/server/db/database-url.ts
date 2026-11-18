// Which database a deployment connects to, and how. Like src/env.schema.ts,
// this module runs under plain Node too: scripts/migrate.ts imports it as well
// as the app's db client, so it must not import `server-only`.

import { createHash } from "node:crypto";

/** The variables that decide which database a deployment uses. */
export type DatabaseEnv = {
  APP_ENV?: string | undefined;
  /** Set by Vercel: the PR number, empty while the branch has no PR. */
  VERCEL_GIT_PULL_REQUEST_ID?: string | undefined;
  /** Set by Vercel: the branch the deployment was built from. */
  VERCEL_GIT_COMMIT_REF?: string | undefined;
};

/** A preview's own database on pg-nonprod (SPEC §2.4). */
export type PreviewDatabase = {
  /** `foa_pr_<n>`, or `foa_br_<branch>` while the branch has no PR. */
  name: string;
  /**
   * The database's comment: `foa-preview pr=<n>` or
   * `foa-preview branch=<ref>`. The hourly sweeper on the VPS parses it to
   * drop the databases of closed PRs and deleted branches, so keep the format.
   */
  comment: string;
};

/** Postgres keeps at most 63 bytes of an identifier (NAMEDATALEN - 1). */
const MAX_NAME_BYTES = 63;
const BRANCH_PREFIX = "foa_br_";
const HASH_CHARS = 8;

const PR_NUMBER = /^[1-9][0-9]*$/;

export const PREVIEW_DATABASE_UNNAMED =
  "APP_ENV=preview needs VERCEL_GIT_PULL_REQUEST_ID (a PR number) or " +
  "VERCEL_GIT_COMMIT_REF (a branch) to name its database, foa_pr_<n> or " +
  "foa_br_<branch>. Vercel sets both for deployments from Git.";

/**
 * Names a preview's database: `foa_pr_<n>` for a PR, else `foa_br_<slug>`
 * from the branch. Throws if neither variable is usable.
 */
export function previewDatabase(env: DatabaseEnv): PreviewDatabase {
  const pr = env.VERCEL_GIT_PULL_REQUEST_ID ?? "";
  if (PR_NUMBER.test(pr)) {
    return { name: `foa_pr_${pr}`, comment: `foa-preview pr=${pr}` };
  }
  const ref = env.VERCEL_GIT_COMMIT_REF ?? "";
  if (ref !== "") {
    return {
      name: branchDatabaseName(ref),
      comment: `foa-preview branch=${ref}`,
    };
  }
  throw new Error(PREVIEW_DATABASE_UNNAMED);
}

/** The name of a preview's database; see `previewDatabase`. */
export function previewDatabaseName(env: DatabaseEnv): string {
  return previewDatabase(env).name;
}

/**
 * `foa_br_` plus the branch lowercased, with every run of other characters
 * than [a-z0-9] turned into one `_`. A name that would pass 63 bytes, or has
 * nothing left of the branch, is cut short and ends in `_` plus 8 hex
 * characters of the branch's SHA-256, so long branches that share a prefix
 * still get databases of their own.
 */
function branchDatabaseName(ref: string): string {
  const slug = ref
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  // The slug is ASCII, so its length is its size in bytes.
  if (slug !== "" && BRANCH_PREFIX.length + slug.length <= MAX_NAME_BYTES) {
    return BRANCH_PREFIX + slug;
  }
  const hash = createHash("sha256")
    .update(ref)
    .digest("hex")
    .slice(0, HASH_CHARS);
  const room = MAX_NAME_BYTES - BRANCH_PREFIX.length - HASH_CHARS - 1;
  const head = slug.slice(0, room).replace(/_+$/, "");
  return head === ""
    ? `${BRANCH_PREFIX}${hash}`
    : `${BRANCH_PREFIX}${head}_${hash}`;
}

/** `url` with its database (the path) replaced by `database`. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.href;
}

/**
 * The URL a deployment really connects to. On previews DATABASE_URL and
 * DIRECT_URL name a placeholder database (`/foa_pr`), shared by every preview
 * in the Vercel settings; this swaps in the preview's own database. PgBouncer
 * sends any database but `foa` to pg-nonprod, so a preview never reaches
 * production. Other environments get `url` unchanged.
 */
export function resolveDatabaseUrl(url: string, env: DatabaseEnv): string {
  return env.APP_ENV === "preview"
    ? withDatabase(url, previewDatabaseName(env))
    : url;
}

/** The sslmodes that always encrypt, which libpq requires for direct TLS. */
const ENCRYPTED_SSLMODES = new Set(["require", "verify-ca", "verify-full"]);

/**
 * postgres.js options for direct TLS negotiation: TLS from the first byte,
 * without the SSLRequest round trip first (PostgreSQL 17+; PgBouncer accepts
 * it since 1.25). Only when the URL's sslmode always encrypts, as libpq
 * allows, so a local URL without sslmode still connects in plain text. TLS
 * itself, and how the certificate is checked, comes from the URL's sslmode;
 * an `sslnegotiation` in the URL wins over this.
 */
export function directTls(url: string): { sslnegotiation?: "direct" } {
  const params = new URL(url).searchParams;
  const sslmode = params.get("sslmode");
  return sslmode !== null &&
    ENCRYPTED_SSLMODES.has(sslmode) &&
    !params.has("sslnegotiation")
    ? { sslnegotiation: "direct" }
    : {};
}
