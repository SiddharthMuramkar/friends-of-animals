// Where a file's object lives. Production has its own buckets and uses no
// prefix; every other environment shares the non-production buckets under a
// prefix of its own: `staging/`, `local/`, or a preview's `pr-<n>/` or
// `br-<hash>/`. A preview's prefix follows its database's name
// (src/server/db/database-url.ts), so when the sweeper drops that database
// `storagePrefixForDatabase` finds the prefix to purge.
//
// Keys are built only from the prefix, the purpose and the file's UUID:
// never from anything the uploader sent.

import {
  previewDatabaseName,
  type DatabaseEnv,
} from "@/server/db/database-url";

import type { FilePurpose } from "./purposes";

// Every preview database name ends in `_<fp>`, the migrations fingerprint,
// so a PR or branch may have had several databases. They all map to one
// prefix: the sweeper drops them together, once the PR or branch is gone.
/** `foa_pr_<n>_<fp>`. */
const PR_DATABASE = /^foa_pr_([1-9][0-9]*)_[0-9a-f]{8}$/;
/** `foa_br_<slug>_<hash>_<fp>` or `foa_br_<hash>_<fp>`. */
const BRANCH_DATABASE = /^foa_br_(?:[a-z0-9_]+_)?([0-9a-f]{8})_[0-9a-f]{8}$/;

/** "" or one lower-case folder ending in "/". */
const PREFIX = /^(?:[a-z0-9-]+\/)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The key prefix this environment's files are stored under. */
export function storagePrefixFor(env: DatabaseEnv): string {
  switch (env.APP_ENV) {
    case "production":
      return "";
    case "staging":
      return "staging/";
    case "preview": {
      const prefix = storagePrefixForDatabase(previewDatabaseName(env));
      if (prefix === null) {
        throw new Error("A preview's database name has no storage prefix.");
      }
      return prefix;
    }
    default:
      return "local/";
  }
}

/**
 * The storage prefix of the preview that owns database `name`, or null if
 * `name` isn't a preview database. Purging must never run on null.
 */
export function storagePrefixForDatabase(name: string): string | null {
  const pr = PR_DATABASE.exec(name);
  if (pr) return `pr-${pr[1]}/`;
  const branch = BRANCH_DATABASE.exec(name);
  if (branch) return `br-${branch[1]}/`;
  return null;
}

function assertSafe(prefix: string, fileId: string): void {
  if (!PREFIX.test(prefix)) {
    throw new Error(`Not a storage prefix: ${JSON.stringify(prefix)}`);
  }
  if (!UUID.test(fileId)) {
    throw new Error(`Not a file id: ${JSON.stringify(fileId)}`);
  }
}

/** `<prefix><purpose>/<fileId>`. */
export function storageKeyFor({
  prefix,
  purpose,
  fileId,
}: {
  prefix: string;
  purpose: FilePurpose;
  fileId: string;
}): string {
  assertSafe(prefix, fileId);
  return `${prefix}${purpose}/${fileId}`;
}

/** `<prefix>quarantine/<fileId>`: where a flagged file is moved. */
export function quarantineKeyFor({
  prefix,
  fileId,
}: {
  prefix: string;
  fileId: string;
}): string {
  assertSafe(prefix, fileId);
  return `${prefix}quarantine/${fileId}`;
}
