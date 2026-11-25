// The video media job (#86): the files.process_video handler, on the media
// queue that only worker-media drains (src/server/outbox/queues.ts). It
// streams the clean original to the MediaProcessor's ffmpeg half, which
// refuses a clip longer than its purpose takes (by ffprobe's measure, the
// authority on length) and otherwise makes the watchable MP4 and its JPEG
// poster, with no metadata. The rest is the image job's
// (./process-image.ts): store the copies, record them, finish the job, or
// fail it with the MediaError's code (video_too_long, no_video_stream,
// media_decode_failed, media_timeout).
//
// A transcode can take minutes, so the relay gives this handler a longer
// lease (HANDLER_LEASE_MS, src/server/outbox/retry-policy.ts) than the
// ffmpeg deadline it can reach.
//
// Loads under plain Node (the worker): relative imports only.

import { PURPOSE_RULES } from "./domain/purposes";
import { settleMediaJob, startJob, type MediaJobDeps } from "./process-image";

export async function processVideoAsset(
  deps: MediaJobDeps,
  { attempt, payload }: { attempt: number; payload: { fileId: string } }
): Promise<void> {
  const file = await startJob(deps, payload.fileId);
  if (!file) return;
  const rule = PURPOSE_RULES[file.purpose];
  const maxDurationMs = "maxDurationMs" in rule ? rule.maxDurationMs : null;
  if (maxDurationMs === null || maxDurationMs === undefined) {
    throw new Error(`File ${file.id}'s purpose takes no video`);
  }
  await settleMediaJob(deps, file, attempt, async () => {
    const source = await deps.storage.read({
      bucket: file.bucket,
      key: file.storageKey,
    });
    const result = await deps.media.processVideo({ source, maxDurationMs });
    return result.derivatives;
  });
}
