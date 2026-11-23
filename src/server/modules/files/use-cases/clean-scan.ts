import type { FileAssetRow } from "../../../db/schema";
import {
  StorageNotConfiguredError,
  type ObjectStorage,
} from "../../../ports/storage";

/** A preview fixture may have scan metadata without an object. */
export async function hasCleanScan(
  storage: ObjectStorage,
  file: Pick<FileAssetRow, "status" | "bucket" | "storageKey"> | undefined
): Promise<boolean> {
  if (file?.status !== "clean") return false;
  try {
    return (
      (await storage.head({ bucket: file.bucket, key: file.storageKey })) !==
      null
    );
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) return false;
    throw error;
  }
}
