import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { readMediaFixture } from "@/test/media-fixtures";
import { webpMetadata } from "@/test/webp";

import { MediaError } from "./media";
import { mediaProcessorContract } from "./media.contract";
import { sharpMediaProcessor } from "./media-sharp";

mediaProcessorContract("sharpMediaProcessor", async () => ({
  processor: sharpMediaProcessor(),
}));

/** The RGB of the pixel at (x, y) of an encoded image. */
async function pixelAt(bytes: Uint8Array, x: number, y: number) {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at]!, data[at + 1]!, data[at + 2]!];
}

/** Whether two colours are within JPEG and WebP compression noise. */
const near = (actual: number[], expected: number[]) =>
  actual.every((channel, i) => Math.abs(channel - expected[i]!) <= 24);

const RED = [220, 30, 30];

describe("sharpMediaProcessor", () => {
  it("plants the metadata the strip checks look for", async () => {
    // Without this, a fixture that lost its metadata would make the
    // contract's "keeps no metadata" checks pass for nothing.
    const kept = await sharp(readMediaFixture("gpsJpeg"))
      .webp()
      .keepMetadata()
      .toBuffer();

    expect(webpMetadata(kept)).toEqual(
      expect.arrayContaining(["EXIF", "XMP ", "Apple", "iPhone"])
    );
  });

  it("turns a rotated JPEG the right way, not just to the right size", async () => {
    // rotated.jpg stores red at the top left and Orientation 6 (turn 90
    // degrees clockwise to view), so upright, red is at the top right.
    const { derivatives } = await sharpMediaProcessor().processImage({
      bytes: readMediaFixture("rotatedJpeg"),
      kinds: ["display_1600"],
    });
    const [display] = derivatives;

    expect(near(await pixelAt(display!.bytes, 390, 10), RED)).toBe(true);
    expect(near(await pixelAt(display!.bytes, 10, 10), RED)).toBe(false);
  });

  it("encodes real WebP pixels that decode at the planned size", async () => {
    const { derivatives } = await sharpMediaProcessor().processImage({
      bytes: readMediaFixture("iphoneHeic"),
      kinds: ["thumb_320", "display_1600"],
    });

    for (const derivative of derivatives) {
      const metadata = await sharp(derivative.bytes).metadata();
      expect(metadata).toMatchObject({
        format: "webp",
        width: derivative.width,
        height: derivative.height,
      });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    }
  });

  it.each(["gpsJpeg", "iphoneHeic"] as const)(
    "refuses %s with more pixels than allowed as image_too_large",
    async (fixture) => {
      const processor = sharpMediaProcessor({ maxInputPixels: 700 * 1099 });
      const error = await processor
        .processImage({
          bytes: readMediaFixture(fixture),
          kinds: ["thumb_320"],
        })
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(MediaError);
      expect(error).toMatchObject({ code: "image_too_large" });
    }
  );

  it("refuses a HEIC cut short as media_decode_failed", async () => {
    const heic = readMediaFixture("iphoneHeic");
    const error = await sharpMediaProcessor()
      .processImage({ bytes: heic.subarray(0, 3000), kinds: ["thumb_320"] })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(MediaError);
    expect(error).toMatchObject({ code: "media_decode_failed" });
  });

  it("keeps a PNG's transparency", async () => {
    const png = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const { derivatives } = await sharpMediaProcessor().processImage({
      bytes: png,
      kinds: ["thumb_320"],
    });

    expect((await sharp(derivatives[0]!.bytes).metadata()).hasAlpha).toBe(true);
  });
});
