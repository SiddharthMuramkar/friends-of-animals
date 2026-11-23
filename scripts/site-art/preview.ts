/**
 * QA contact sheet: renders each illustration on the site's light paper
 * (#FEFAF2) and dark background (#171511), so halos, crops and dark-theme
 * legibility can be checked by eye. A living illustration's strip shows
 * every frame (frame count from the art.json beside its folder).
 *
 *   pnpm exec tsx scripts/site-art/preview.ts <out.png> <file.webp>... [--cell 220]
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const args = process.argv.slice(2);
const ci = args.indexOf("--cell");
const CELL = ci === -1 ? 220 : Number(args.splice(ci, 2)[1]);
const [out, ...files] = args;
if (!out || !files.length)
  throw new Error("usage: preview.ts <out.png> <file.webp>...");

const PAD = 12;
const BACKGROUNDS = ["#FEFAF2", "#171511"];

function framesOf(file: string): number {
  const registry = path.join(path.dirname(file), "..", "art.json");
  if (!existsSync(registry)) return 1;
  const id = path.basename(file, ".webp");
  const entry = (
    JSON.parse(readFileSync(registry, "utf8")) as {
      id: string;
      frames?: number | null;
    }[]
  ).find((e) => e.id === id);
  return entry?.frames ?? 1;
}

const rows: { tiles: Buffer[] }[] = [];
for (const file of files) {
  const meta = await sharp(file).metadata();
  const frames = framesOf(file);
  const fw = Math.floor(meta.width! / frames);
  for (const bg of BACKGROUNDS) {
    const tiles: Buffer[] = [];
    for (let f = 0; f < frames; f++) {
      const frame = await sharp(file)
        .extract({ left: f * fw, top: 0, width: fw, height: meta.height! })
        .resize(CELL, CELL, { fit: "inside" })
        .toBuffer();
      const fm = await sharp(frame).metadata();
      tiles.push(
        await sharp({
          create: {
            width: CELL + PAD * 2,
            height: CELL + PAD * 2,
            channels: 4,
            background: bg,
          },
        })
          .composite([
            {
              input: frame,
              left: PAD + Math.round((CELL - fm.width!) / 2),
              top: PAD + Math.round((CELL - fm.height!) / 2),
            },
          ])
          .png()
          .toBuffer()
      );
    }
    rows.push({ tiles });
  }
}
const size = CELL + PAD * 2;
const cols = Math.max(...rows.map((r) => r.tiles.length));
await sharp({
  create: {
    width: cols * size,
    height: rows.length * size,
    channels: 4,
    background: "#888",
  },
})
  .composite(
    rows.flatMap((r, y) =>
      r.tiles.map((input, x) => ({ input, left: x * size, top: y * size }))
    )
  )
  .png()
  .toFile(out);
console.log(out);
