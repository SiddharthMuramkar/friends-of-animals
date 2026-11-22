import { MediaError, type MediaInput } from "../server/ports/media";
import { sharpMediaProcessor } from "../server/ports/media-sharp";

import type { MediaProcessReply } from "./process-media";

async function processJob(input: MediaInput): Promise<MediaProcessReply> {
  try {
    return { result: await sharpMediaProcessor().processImage(input) };
  } catch (error) {
    if (error instanceof MediaError) return { code: error.code };
    throw error;
  }
}

process.once("message", (input: MediaInput) => {
  void processJob(input).then(
    (reply) => {
      process.send?.(reply, (error) => {
        if (error) process.exitCode = 1;
        if (process.connected) process.disconnect?.();
      });
    },
    () => {
      process.exitCode = 1;
      if (process.connected) process.disconnect?.();
    }
  );
});
