// In-memory MediaProcessor for Seam 1 tests. Not implemented yet.

import type {
  MediaErrorCode,
  MediaInput,
  MediaProcessor,
  MediaResult,
} from "@/server/ports/media";

export class FakeMediaProcessor implements MediaProcessor {
  readonly processed: MediaInput[] = [];

  failNext(_times: number, _code: MediaErrorCode = "media_decode_failed") {}

  processImage(_input: MediaInput): Promise<MediaResult> {
    return Promise.reject(new Error("Not implemented"));
  }
}
