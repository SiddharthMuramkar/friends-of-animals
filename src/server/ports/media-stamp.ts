// Worker-media adapter: only approved, committed watermark PNGs are
// composited. All pixels are newly decoded and encoded; no source metadata
// is copied. Certificate PDFs are first rasterized into a private scratch
// directory with Poppler, never passed through or altered.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { MediaError, type StampProcessor } from "./media";
import { STAMP_SETTINGS } from "../modules/stamping/domain/variants";

const run = promisify(execFile);
const ASPECT = 590 / 1024;
const ASSETS = {
  colour: "foa-logo-watermark.png",
  white: "foa-logo-watermark-white.png",
  black: "foa-logo-watermark-black.png",
} as const;

async function certificatePixels(bytes: Uint8Array): Promise<Uint8Array> {
  if (
    bytes.length > 10 * 1024 * 1024 ||
    Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
  )
    throw new MediaError("media_decode_failed");
  const folder = await mkdtemp(join(tmpdir(), "foa-certificate-share-"));
  try {
    await writeFile(join(folder, "page.pdf"), bytes, { mode: 0o600 });
    await run(
      "pdftoppm",
      [
        "-f",
        "1",
        "-l",
        "1",
        "-singlefile",
        "-hide-annotations",
        "-scale-to",
        "2200",
        "-png",
        "page.pdf",
        "raster",
      ],
      {
        cwd: folder,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          NODE_ENV: "production",
        },
        timeout: 90_000,
        killSignal: "SIGKILL",
        maxBuffer: 16_384,
      }
    ).catch(() => {
      throw new MediaError("media_decode_failed");
    });
    return await readFile(join(folder, "raster.png"));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

function luminance(r: number, g: number, b: number) {
  const linear = (byte: number) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Sample the actual footprint, not the image's overall brightness.
 * On highly mixed tones neither black nor white reliably contrasts: use
 * the black approved mark on a solid white backing, without changing it. */
async function chooseAsset(
  pixels: Buffer,
  rectangle: { left: number; top: number; width: number; height: number }
) {
  const samples = await sharp(pixels)
    .extract(rectangle)
    .resize({ width: 24, height: 24, fit: "fill" })
    .raw()
    .toBuffer();
  const values = [];
  for (let i = 0; i < samples.length; i += 3)
    values.push(luminance(samples[i]!, samples[i + 1]!, samples[i + 2]!));
  values.sort((a, b) => a - b);
  // Require the selected mark to contrast across almost the entire region:
  // a few outlier pixels should not force a backing for a uniform photo.
  const low = values[Math.floor(values.length * 0.1)]!;
  const high = values[Math.floor(values.length * 0.9)]!;
  if (high <= 0.18) return { asset: ASSETS.white, backing: false };
  if (low >= 0.72) return { asset: ASSETS.black, backing: false };
  if (low >= 0.3) return { asset: ASSETS.colour, backing: false };
  if (low >= 0.18) return { asset: ASSETS.black, backing: false };
  return { asset: ASSETS.black, backing: true };
}

export function stampProcessor(
  options: { brandDirectory?: string } = {}
): StampProcessor {
  return {
    async stampImage({ bytes, variant }) {
      const settings = STAMP_SETTINGS[variant];
      const cert = variant === "certificate_share";
      const source = cert ? await certificatePixels(bytes) : bytes;
      try {
        const base = await sharp(source, {
          limitInputPixels: 6_000_000,
          pages: 1,
        })
          .resize({
            width: settings.maxEdge,
            height: settings.maxEdge,
            fit: "inside",
            withoutEnlargement: true,
          })
          .flatten({ background: "#ffffff" })
          .toColourspace("srgb")
          .removeAlpha()
          .png()
          .toBuffer({ resolveWithObject: true });
        const { width, height } = base.info;
        const margin = Math.max(1, Math.round(Math.min(width, height) * 0.03));
        const markWidth = Math.floor(
          Math.min(
            width * 0.2,
            width - 2 * margin,
            (height - 2 * margin) / ASPECT,
            320
          )
        );
        // Full logo always: at extreme sizes an unreadable mark is worse
        // than refusing to make a public copy. Never arbitrarily crop tiles.
        if (markWidth < 48) throw new MediaError("media_decode_failed");
        const markHeight = Math.round(markWidth * ASPECT);
        // Extend only the certificate share raster, so neither the QR nor
        // text nor signatories can be covered by a second FOA mark.
        const canvas = cert
          ? await sharp(base.data)
              .extend({
                top: 0,
                bottom: markHeight + 2 * margin,
                left: 0,
                right: 0,
                background: "#fff",
              })
              .png()
              .toBuffer()
          : base.data;
        const totalHeight = cert ? height + markHeight + 2 * margin : height;
        const rect = {
          left: width - margin - markWidth,
          top: totalHeight - margin - markHeight,
          width: markWidth,
          height: markHeight,
        };
        const choice = await chooseAsset(canvas, rect);
        const asset = await readFile(
          join(
            options.brandDirectory ?? join(process.cwd(), "public/brand"),
            choice.asset
          )
        );
        const mark = await sharp(asset)
          .resize({ width: markWidth })
          .png()
          .toBuffer();
        const overlay = choice.backing
          ? await sharp({
              create: {
                width: markWidth,
                height: markHeight,
                channels: 3,
                background: "#fff",
              },
            })
              .composite([{ input: mark, top: 0, left: 0 }])
              .png()
              .toBuffer()
          : mark;
        const output = sharp(canvas)
          .composite([{ input: overlay, top: rect.top, left: rect.left }])
          .removeAlpha();
        return {
          width,
          height: totalHeight,
          contentType: settings.contentType,
          bytes:
            settings.contentType === "image/png"
              ? await output.png().toBuffer()
              : await output.webp({ quality: 85 }).toBuffer(),
        };
      } catch (error) {
        if (error instanceof MediaError) throw error;
        throw new MediaError("media_decode_failed");
      }
    },
  };
}
