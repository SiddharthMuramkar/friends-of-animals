import { expect, it } from "vitest";
import sharp from "sharp";
import { essayPdf, PDF_IDENTITY_MARKER } from "@/test/pdf-fixtures";
import { stampProcessor } from "./media-stamp";

it("rasterizes a PDF into a new share PNG, retaining visible work without embedding PDF structures or personal metadata", async () => {
  const original = essayPdf(1);
  const before = original.slice();
  const image = await stampProcessor().stampImage({
    bytes: original,
    variant: "certificate_share",
  });
  expect(original).toEqual(before);
  expect(image.contentType).toBe("image/png");
  expect(image.width).toBe(2200);
  expect(image.height).toBeGreaterThan(2200);
  const pixels = await sharp(image.bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(pixels.info).toMatchObject({
    width: image.width,
    height: image.height,
    channels: 3,
  });
  // The fixture paints a blue block at bottom-left, in its first page.
  const x = (100 * 2200) / 400;
  const y = (330 * 2200) / 400;
  const offset = (y * image.width + x) * 3;
  expect([...pixels.data.subarray(offset, offset + 3)]).toEqual([0, 0, 255]);
  const meta = await sharp(image.bytes).metadata();
  expect(meta.exif).toBeUndefined();
  expect(meta.xmp).toBeUndefined();
  expect(meta.iptc).toBeUndefined();
  expect(meta.icc).toBeUndefined();
  expect(Buffer.from(image.bytes).toString("latin1")).not.toContain(
    PDF_IDENTITY_MARKER
  );
});
