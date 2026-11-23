/**
 * QA for an illustration's hotspots: draws each point (percent of width and
 * height) as a numbered ring on the image, to check by eye that every
 * hotspot sits on its animal.
 *
 *   pnpm exec tsx scripts/site-art/overlay.ts <image> <out.png> '[{"id":"cow","x":88,"y":78}]'
 */
import sharp from "sharp";

const [image, out, json] = process.argv.slice(2);
if (!image || !out || !json)
  throw new Error("usage: overlay.ts <image> <out.png> <points-json>");
const points = JSON.parse(json) as { id: string; x: number; y: number }[];
const { width, height } = await sharp(image).metadata();
const r = Math.round(width / 60);
const marks = points
  .map((p, i) => {
    const cx = (p.x / 100) * width;
    const cy = (p.y / 100) * height;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ff00aa" stroke-width="4"/>
<text x="${cx + r + 4}" y="${cy + 6}" font-family="sans-serif" font-size="${r}" font-weight="700" fill="#ff00aa" stroke="#fff" stroke-width="1">${i + 1} ${p.id}</text>`;
  })
  .join("\n");
await sharp(image)
  .composite([
    {
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${marks}</svg>`
      ),
    },
  ])
  .png()
  .toFile(out);
console.log(out);
