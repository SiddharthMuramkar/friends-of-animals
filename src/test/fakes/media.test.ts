import { describe, expect, it } from "vitest";

import { MediaError } from "@/server/ports/media";
import {
  mediaProcessorContract,
  pdfProcessorContract,
  streamOf,
  videoProcessorContract,
} from "@/server/ports/media.contract";
import { readMediaFixture } from "@/test/media-fixtures";

import { FakeMediaProcessor } from "./media";

mediaProcessorContract("FakeMediaProcessor", async () => ({
  processor: new FakeMediaProcessor(),
}));

videoProcessorContract("FakeMediaProcessor", async () => ({
  processor: new FakeMediaProcessor(),
}));

pdfProcessorContract("FakeMediaProcessor", async () => ({
  processor: new FakeMediaProcessor(),
}));

describe("FakeMediaProcessor videos", () => {
  it("probes as a test says, and refuses past the limit by the shared rule", async () => {
    const media = new FakeMediaProcessor();
    media.nextVideo({ durationMs: 181_000, width: 1080, height: 1920 });
    media.nextVideo({ durationMs: 181_001 });
    media.nextVideo("no_video_stream");
    const call = () =>
      media.processVideo({
        source: streamOf(readMediaFixture("gpsMov")),
        maxDurationMs: 180_000,
      });

    const fits = await call();
    expect(fits.derivatives[0]).toMatchObject({ width: 1080, height: 1920 });
    await expect(call()).rejects.toMatchObject({ code: "video_too_long" });
    await expect(call()).rejects.toMatchObject({ code: "no_video_stream" });
    expect(media.videos).toEqual([
      { sizeBytes: readMediaFixture("gpsMov").length, maxDurationMs: 180_000 },
      { sizeBytes: readMediaFixture("gpsMov").length, maxDurationMs: 180_000 },
      { sizeBytes: readMediaFixture("gpsMov").length, maxDurationMs: 180_000 },
    ]);
  });
});

describe("FakeMediaProcessor", () => {
  it("records every input it was given, oldest first", async () => {
    const media = new FakeMediaProcessor();
    const jpeg = readMediaFixture("gpsJpeg");
    const heic = readMediaFixture("iphoneHeic");
    await media.processImage({ bytes: jpeg, kinds: ["thumb_320"] });
    await media
      .processImage({ bytes: new Uint8Array(), kinds: [] })
      .catch(() => undefined);
    await media.processImage({ bytes: heic, kinds: ["display_1600"] });

    expect(media.processed).toEqual([
      { bytes: jpeg, kinds: ["thumb_320"] },
      { bytes: new Uint8Array(), kinds: [] },
      { bytes: heic, kinds: ["display_1600"] },
    ]);
  });

  it("fails the next calls with the code it was told, then recovers", async () => {
    const media = new FakeMediaProcessor();
    media.failNext(2, "image_too_large");
    const input = { bytes: readMediaFixture("gpsJpeg"), kinds: [] };

    for (let call = 0; call < 2; call += 1) {
      const error = await media
        .processImage(input)
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(MediaError);
      expect(error).toMatchObject({ code: "image_too_large" });
    }
    await expect(media.processImage(input)).resolves.toMatchObject({
      sniffedType: "image/jpeg",
    });
  });

  it("fails with media_decode_failed unless told another code", async () => {
    const media = new FakeMediaProcessor();
    media.failNext(1);

    await expect(
      media.processImage({ bytes: readMediaFixture("gpsJpeg"), kinds: [] })
    ).rejects.toMatchObject({ code: "media_decode_failed" });
  });

  it("refuses a PNG with no IEND chunk as media_decode_failed", async () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
      0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10, 8, 2, 0, 0, 0, 0, 0, 0, 0,
    ]);

    await expect(
      new FakeMediaProcessor().processImage({ bytes: png, kinds: [] })
    ).rejects.toMatchObject({ code: "media_decode_failed" });
  });
});
