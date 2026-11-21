// The media job. Not implemented yet.

import type { AppDb } from "../../db/app-db";
import type { FileAssetRow } from "../../db/schema";
import type { Clock } from "../../ports/clock";
import type { MediaProcessor } from "../../ports/media";
import type { ObjectStorage } from "../../ports/storage";

export type MediaJobDeps = {
  db: AppDb;
  clock: Clock;
  storage: ObjectStorage;
  media: MediaProcessor;
};

export async function queueMediaWork(
  _tx: AppDb,
  _clock: Clock,
  _file: Pick<FileAssetRow, "id" | "purpose" | "contentType">
): Promise<boolean> {
  return false;
}

export async function processImageAsset(
  _deps: MediaJobDeps,
  _delivery: { attempt: number; payload: { fileId: string } }
): Promise<void> {}
