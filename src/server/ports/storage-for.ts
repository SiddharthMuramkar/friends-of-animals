// Storage selection shared by the app and the preview seed command.
// Loads under plain Node without reading the deployment environment.

import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Env } from "../../env.schema";
import { systemClock } from "./clock";
import { unconfiguredStorage, type ObjectStorage } from "./storage";
import { diskStorage, signingKeyFor, type DiskStorage } from "./storage-disk";
import { r2Storage, type R2Config } from "./storage-r2";

/** The R2 variables (src/env.schema.ts): all of them, or none. */
export type StorageEnv = {
  R2_ACCOUNT_ID?: string | undefined;
  R2_ACCESS_KEY_ID?: string | undefined;
  R2_SECRET_ACCESS_KEY?: string | undefined;
  R2_BUCKET?: string | undefined;
  PUBLIC_ASSET_BASE_URL?: string | undefined;
};

export type LocalStorageEnv = {
  APP_ENV: Env["APP_ENV"];
  /** The app's base URL, where the disk store's signed URLs point. */
  APP_URL: string;
};

export function r2ConfigOf({
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
}: StorageEnv): R2Config | null {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return null;
  }
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  };
}

/** Uses R2 when configured and the disk store on an offline local run. */
export function storageFor(env: StorageEnv & LocalStorageEnv): ObjectStorage {
  const r2 = r2ConfigOf(env);
  if (r2) return r2Storage(r2, systemClock);
  return localDiskStorageFor(env) ?? unconfiguredStorage;
}

/** Where a local run's disk store keeps files: outside any worktree. */
export const LOCAL_STORAGE_ROOT = join(tmpdir(), "foa-local-storage");

/** The disk store used by the local-only signed upload and delivery route. */
export function localDiskStorageFor(
  env: StorageEnv & LocalStorageEnv,
  root: string = LOCAL_STORAGE_ROOT
): DiskStorage | null {
  if (env.APP_ENV !== "local" || r2ConfigOf(env)) return null;
  return diskStorage(
    {
      root,
      baseUrl: new URL("/api/local-storage/", env.APP_URL).href,
      // This installation's own random key, never a shared or public one.
      secret: signingKeyFor(root),
    },
    systemClock
  );
}
