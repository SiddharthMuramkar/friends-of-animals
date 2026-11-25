// The essay PDF media job (#96), dispatched only after the malware scan
// passes. Like the image/video jobs, a safe copy is stored before the
// outbox tells Entries its upload is ready. Never falls back to the original.
// Loads under plain Node (the worker): relative imports only.

import { mediaJobFor } from "./domain/media-work";
import {
  readAll,
  settleMediaJob,
  startJob,
  type MediaJobDeps,
} from "./process-image";

export async function processPdfAsset(
  deps: MediaJobDeps,
  { attempt, payload }: { attempt: number; payload: { fileId: string } }
): Promise<void> {
  const file = await startJob(deps, payload.fileId);
  if (!file) return;
  if (mediaJobFor(file) !== "pdf") {
    throw new Error("The file does not take a PDF derivative");
  }
  await settleMediaJob(deps, file, attempt, async () => {
    const bytes = await readAll(
      await deps.storage.read({ bucket: file.bucket, key: file.storageKey })
    );
    return [await deps.media.processPdf({ bytes })];
  });
}
