// Files seed data (#63): one clean demo file per seeded member, so a
// preview has file rows that later modules' seed data can point at.
// Metadata only: no object is written, so a download link to one leads
// nowhere. The key sits under this deployment's prefix (`pr-<n>/` on a
// PR's preview), the one the sweeper's hook purges when the preview's
// database is dropped. Loads under plain Node (the seed script): relative
// imports only, no "server-only".

import { fileAsset } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import {
  storageKeyFor,
  storagePrefixFor,
} from "../modules/files/domain/storage-key";
import { SEED_ACCOUNTS } from "./accounts";
import type { Seeder } from "./types";

/** Each seeded member's demo file, with a fixed id so links can name it. */
const SEED_FILES = SEED_ACCOUNTS.members.map((account, index) => ({
  account,
  id: `01938a00-0000-7000-8000-00000000020${index + 1}`,
}));

/** A 1×1 PNG's size, as if one had been uploaded. */
const DEMO_PNG_BYTES = 68;

export type SeedFilesLocation = { bucket: string; keyPrefix: string };

/**
 * The bucket and key prefix the app uses in this deployment, worked out as
 * `filesConfigFor` (src/server/deps.ts) does: the seed script runs with
 * the deployment's variables, before the app starts.
 */
export function seedFilesLocation(
  env: Readonly<Record<string, string | undefined>> = process.env
): SeedFilesLocation {
  return {
    bucket: env.R2_BUCKET || "unconfigured",
    keyPrefix: storagePrefixFor(env),
  };
}

/** Seeds the demo files at `location`. */
export function seedFilesAt({ bucket, keyPrefix }: SeedFilesLocation): Seeder {
  return async (deps) => {
    const now = deps.clock.now();
    for (const { account, id } of SEED_FILES) {
      // By address, as the access seed does: the account keeps its own id.
      const owner = await ensureVerifiedAccount(deps, account);
      await deps.db
        .insert(fileAsset)
        .values({
          id,
          ownerUserId: owner.id,
          purpose: "test_upload",
          contentType: "image/png",
          sizeBytes: DEMO_PNG_BYTES,
          bucket,
          storageKey: storageKeyFor({
            prefix: keyPrefix,
            purpose: "test_upload",
            fileId: id,
          }),
          // Never scanned (there are no bytes): clean so the gate lets
          // its owner through, with no scan result or hash to claim.
          status: "clean",
          uploadedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
  };
}

/** The demo files, at this deployment's bucket and prefix. */
export const seedFiles: Seeder = (deps) =>
  seedFilesAt(seedFilesLocation())(deps);
