/**
 * Contact sheet for judging raw generations: tiles the given images in a
 * grid (`--cols`, default 2) at `--cell` px, each with its file name.
 *
 *   pnpm exec tsx scripts/site-art/contact.ts out.png a.png b.png --cols 3
 */
import path from "node:path";

import sharp, { type OverlayOptions } from "sharp";

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number(args[i + 1]);
  args.splice(i, 2);
  return value;
};
const cols = flag("cols", 2);
const cell = flag("cell", 420);
const bgIndex = args.indexOf("--bg");
const bg = bgIndex === -1 ? "#ddd" : args.splice(bgIndex, 2)[1]!;
const [out, ...files] = args;
if (!out || !files.length)
  throw new Error(
    "usage: contact.ts <out.png> <img>... [--cols n] [--cell px]"
  );

const LABEL = 22;
const rows = Math.ceil(files.length / cols);
const tiles: OverlayOptions[] = [];
for (const [i, file] of files.entries()) {
  const x = (i % cols) * cell;
  const y = Math.floor(i / cols) * (cell + LABEL);
  const img = await sharp(file)
    .resize(cell - 8, cell - 8, { fit: "inside" })
    .toBuffer();
  const meta = await sharp(img).metadata();
  tiles.push({
    input: img,
    left: x + 4 + Math.round((cell - 8 - meta.width!) / 2),
    top: y + LABEL + 4 + Math.round((cell - 8 - meta.height!) / 2),
  });
  const name = path.basename(file).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  tiles.push({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${LABEL}"><text x="6" y="16" font-family="sans-serif" font-size="14" fill="#888">${name}</text></svg>`
    ),
    left: x,
    top: y,
  });
}
await sharp({
  create: {
    width: cols * cell,
    height: rows * (cell + LABEL),
    channels: 3,
    background: bg,
  },
})
  .composite(tiles)
  .png()
  .toFile(out);
console.log(out);
