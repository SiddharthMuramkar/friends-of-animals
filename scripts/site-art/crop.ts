/**
 * Crops a region of an image onto grey, for looking at details up close.
 *   pnpm exec tsx scripts/site-art/crop.ts <in> <out.png> <left> <top> <width> <height> [scale]
 */
import sharp from "sharp";

const [src, out, left, top, width, height, scale] = process.argv.slice(2);
if (!src || !out || !left || !top || !width || !height) {
  throw new Error(
    "usage: crop.ts <in> <out.png> <left> <top> <width> <height> [scale]"
  );
}
const w = Number(width);
const h = Number(height);
await sharp(src)
  .extract({ left: Number(left), top: Number(top), width: w, height: h })
  .flatten({ background: "#dddddd" })
  .resize(
    Math.round(w * Number(scale ?? 1)),
    Math.round(h * Number(scale ?? 1))
  )
  .toFile(out);
console.log(out);
