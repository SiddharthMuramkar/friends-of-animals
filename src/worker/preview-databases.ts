// Which preview databases on pg-nonprod the shared preview worker serves.
// Preview builds create `foa_pr_<n>` or `foa_br_<slug>_<hash>` and label it
// with a database comment (scripts/preview-database.ts); the hourly sweeper
// (docker/scripts/sweep-preview-dbs.sh) drops it once its PR closes or its
// branch is gone. The worker serves exactly what the sweeper would recognise,
// with the same name and label rules, and stops when a database disappears.
//
// Pure, and loads under plain Node: no "server-only", no Next imports.

/** One row of `pg_database` with its comment. */
export type ListedDatabase = { datname: string; comment: string | null };

// The sweeper's rules, kept identical.
const PREVIEW_NAME = /^foa_(pr|br)_[a-z0-9_]{1,56}$/;
const PR_LABEL = /^foa-preview pr=([0-9]{1,9})$/;
const BRANCH_LABEL = /^foa-preview branch=[A-Za-z0-9][A-Za-z0-9._/+@-]{0,200}$/;

function isServedPreview({ datname, comment }: ListedDatabase): boolean {
  if (comment === null || !PREVIEW_NAME.test(datname)) return false;
  const pr = PR_LABEL.exec(comment);
  if (pr) return datname === `foa_pr_${pr[1]}`;
  return BRANCH_LABEL.test(comment) && datname.startsWith("foa_br_");
}

/**
 * The preview databases to serve, in name order: a `foa_pr_<n>` labelled
 * `foa-preview pr=<n>` (same n), or a `foa_br_…` labelled
 * `foa-preview branch=<ref>`. Anything else, including `foa_seed`,
 * `foa_staging`, `postgres` and the templates, is never served.
 */
export function previewDatabasesToServe(
  listed: readonly ListedDatabase[]
): string[] {
  const names = new Set(listed.filter(isServedPreview).map((d) => d.datname));
  return [...names].sort();
}

/**
 * What to change so the worker serves `toServe`: databases to attach (new
 * since the last look) and to detach (served, but no longer listed).
 */
export function planPreviewChanges(
  serving: Iterable<string>,
  toServe: readonly string[]
): { attach: string[]; detach: string[] } {
  const current = new Set(serving);
  const wanted = new Set(toServe);
  return {
    attach: [...wanted].filter((name) => !current.has(name)).sort(),
    detach: [...current].filter((name) => !wanted.has(name)).sort(),
  };
}

/** SQLSTATE invalid_catalog_name: the database doesn't exist (dropped). */
const INVALID_CATALOG_NAME = "3D000";

/** How many `cause` links to follow; Drizzle wraps driver errors once. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Whether `error` says the database is gone, so the worker stops serving it
 * now instead of retrying. Follows `cause`, because Drizzle wraps the driver's
 * error. A killed session (57P01, as `DROP DATABASE … WITH (FORCE)` causes)
 * isn't "gone": the next discovery or connection settles it.
 */
export function isDatabaseGone(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return false;
    if ("code" in current && current.code === INVALID_CATALOG_NAME) {
      return true;
    }
    current = current.cause;
  }
  return false;
}
