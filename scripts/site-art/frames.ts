/**
 * QA sheet of a video's frames for choosing a living illustration's frames by
 * hand: every `--every`th frame, green keyed, on the light paper, labelled
 * with its index (the index `source.pick` takes in the manifest).
 *
 *   pnpm exec tsx scripts/site-art/frames.ts <video.mp4> <out.png> [--every 4] [--cell 200]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp, { type OverlayOptions } from "sharp";

import { chromaKey, fromRgba, toRgba } from "./lib";

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args.splice(i, 2)[1]);
};
const every = flag("every", 4);
const cell = flag("cell", 200);
const [video, out] = args;
if (!video || !out)
  throw new Error(
    "usage: frames.ts <video.mp4> <out.png> [--every n] [--cell px]"
  );

const tmp = mkdtempSync(path.join(tmpdir(), "foa-frames-"));
try {
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    video,
    "-fps_mode",
    "passthrough",
    path.join(tmp, "f%04d.png"),
  ]);
  const files = readdirSync(tmp)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => path.join(tmp, f));
  const picks = files.flatMap((f, i) =>
    i % every === 0 || i === files.length - 1 ? [{ f, i }] : []
  );
  const cols = 7;
  const label = 20;
  const rows = Math.ceil(picks.length / cols);
  const tiles: OverlayOptions[] = [];
  for (const [k, { f, i }] of picks.entries()) {
    const keyed = chromaKey(await toRgba(f));
    const img = await fromRgba(keyed)
      .resize(cell, cell, {
        fit: "contain",
        background: { r: 254, g: 250, b: 242, alpha: 1 },
      })
      .flatten({ background: "#FEFAF2" })
      .png()
      .toBuffer();
    const x = (k % cols) * cell;
    const y = Math.floor(k / cols) * (cell + label);
    tiles.push({ input: img, left: x, top: y + label });
    const svg = `<svg width="${cell}" height="${label}"><text x="4" y="15" font-size="14" font-family="sans-serif">${i}</text></svg>`;
    tiles.push({ input: Buffer.from(svg), left: x, top: y });
  }
  await sharp({
    create: {
      width: cols * cell,
      height: rows * (cell + label),
      channels: 3,
      background: "#dddddd",
    },
  })
    .composite(tiles)
    .png()
    .toFile(out);
  console.log(`${out}: ${files.length} frames, every ${every}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
