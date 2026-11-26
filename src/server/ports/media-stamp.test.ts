import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, it } from "vitest";
import { stampProcessor } from "./media-stamp";

it("chooses the actual approved black/white/colour assets for light/dark/midtone pixels, preserves the source, and strips metadata", async () => {
  for (const [background, asset] of [
    ["#ffffff", "foa-logo-watermark-black.png"],
    ["#000000", "foa-logo-watermark-white.png"],
    ["#b5b5b5", "foa-logo-watermark.png"],
  ] as const) {
    const source = await sharp({
      create: { width: 800, height: 600, channels: 3, background },
    })
      .withExif({ IFD0: { Artist: "Private artist" } })
      .png()
      .toBuffer();
    const before = Buffer.from(source);
    const out = await stampProcessor().stampImage({
      bytes: source,
      variant: "social",
    });
    expect(out).toMatchObject({
      width: 800,
      height: 600,
      contentType: "image/png",
    });
    expect(source).toEqual(before);
    expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
    expect((await sharp(out.bytes).metadata()).icc).toBeUndefined();
    // V1: 20% of image width, 3% of the short edge inset (18px).
    // Compare independently composited approved PNG with the produced region.
    const mark = await sharp(await readFile(`public/brand/${asset}`))
      .resize({ width: 160 })
      .png()
      .toBuffer();
    const { height } = await sharp(mark).metadata();
    const patch = await sharp(out.bytes)
      .extract({ left: 622, top: 600 - 18 - height, width: 160, height })
      .raw()
      .toBuffer();
    const expected = await sharp({
      create: { width: 160, height, channels: 3, background },
    })
      .composite([{ input: mark, left: 0, top: 0 }])
      .removeAlpha()
      .raw()
      .toBuffer();
    expect(patch).toEqual(expected);
  }
});

import { readMediaFixture } from "@/test/media-fixtures";
import { webpMetadata } from "@/test/webp";
import { sharpMediaProcessor } from "./media-sharp";

it("makes a bounded clean WebP gallery copy from a resized GPS photo, not from its original", async () => {
  const original = readMediaFixture("gpsJpeg");
  const [display] = (
    await sharpMediaProcessor().processImage({
      bytes: original,
      kinds: ["display_1600"],
    })
  ).derivatives;
  const image = await stampProcessor().stampImage({
    bytes: display!.bytes,
    variant: "gallery",
  });
  expect(image).toMatchObject({
    width: 800,
    height: 600,
    contentType: "image/webp",
  });
  expect(webpMetadata(image.bytes)).toEqual([]);
  expect((await sharp(image.bytes).metadata()).format).toBe("webp");
  const thumb = await stampProcessor().stampImage({
    bytes: display!.bytes,
    variant: "gallery_thumb",
  });
  expect(thumb).toMatchObject({
    width: 480,
    height: 360,
    contentType: "image/webp",
  });
  expect(webpMetadata(thumb.bytes)).toEqual([]);
  expect(thumb.bytes.length).toBeLessThan(image.bytes.length);
});

it("uses the exact approved tiles-only icon at a small placement rather than cropping the full mark", async () => {
  const source = await sharp({
    create: { width: 128, height: 128, channels: 3, background: "#333333" },
  })
    .png()
    .toBuffer();
  const result = await stampProcessor().stampImage({
    bytes: source,
    variant: "social",
  });
  expect(result).toMatchObject({
    width: 128,
    height: 128,
    contentType: "image/png",
  });
  const patch = await sharp(result.bytes)
    .extract({ left: 99, top: 99, width: 25, height: 25 })
    .raw()
    .toBuffer();
  const icon = await sharp(await readFile("public/brand/apple-touch-icon.png"))
    .resize({ width: 25 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect(patch).toEqual(icon);
});
