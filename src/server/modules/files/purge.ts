// Purging a dropped preview's files (#63). When the sweeper drops a
// preview's database (docker/scripts/sweep-preview-dbs.sh), its hook runs
// `pnpm files:purge-preview --database <name>`, which deletes every object
// under that preview's prefix in the non-production bucket: `pr-<n>/` or
// `br-<hash>/`, mapped from the name by `storagePrefixForDatabase`.
//
// A name with no preview prefix is refused, so a purge can never reach
// staging's, a local run's or production's files. Production refuses
// outright: its storage has no previews.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { Env } from "../../../env.schema";
import type { ObjectStorage } from "../../ports/storage";
import { storagePrefixForDatabase } from "./domain/storage-key";

export type PurgeDeps = {
  storage: ObjectStorage;
  /** The non-production bucket every preview shares. */
  bucket: string;
  appEnv: Env["APP_ENV"];
};

/** Only a preview's own folder: `pr-<n>/` or `br-<hash>/`. */
const PREVIEW_PREFIX = /^(?:pr-[1-9][0-9]*|br-[0-9a-f]{8})\/$/;

/** Thrown, before anything is deleted, for a purge that must not run. */
export class PurgeRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurgeRefusedError";
  }
}

/**
 * Deletes every object under the prefix of the preview whose database was
 * `database`, and says which prefix and how many objects. Safe to run
 * again: a second run finds nothing to delete.
 */
export async function purgePreviewFiles(
  { storage, bucket, appEnv }: PurgeDeps,
  { database }: { database: string }
): Promise<{ prefix: string; deleted: number }> {
  if (appEnv === "production") {
    throw new PurgeRefusedError(
      "Refusing to purge with APP_ENV=production: production storage has " +
        "no preview files. Run it with the non-production bucket's credentials."
    );
  }
  const prefix = storagePrefixForDatabase(database);
  if (prefix === null || !PREVIEW_PREFIX.test(prefix)) {
    throw new PurgeRefusedError(
      `${JSON.stringify(database)} is not a preview database ` +
        "(foa_pr_<n>_<fp> or foa_br_…_<hash>_<fp>), so it has no files " +
        "to purge. Nothing was deleted."
    );
  }
  const { deleted } = await storage.deletePrefix({ bucket, prefix });
  return { prefix, deleted };
}
