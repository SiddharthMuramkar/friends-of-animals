/**
 * Builds the site's AI illustrations from the downloaded generations listed in
 * .art-staging/manifest.json (git-ignored): crops sheet cells, clears flat
 * backgrounds, adds the white die-cut sticker edge, turns a video into a
 * frame strip for a living illustration, embeds the IPTC provenance XMP,
 * writes src/assets/site-art/<folder>/<id>.webp and regenerates
 * src/assets/site-art/art.json. Idempotent: rerun after any manifest change.
 *
 *   pnpm art:build            # every entry
 *   pnpm art:build <id> ...   # just these (art.json keeps the others)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp, { type Sharp } from "sharp";

import {
  type Rgba,
  chromaKey,
  colourTransfer,
  dieCut,
  frameDistance,
  fromRgba,
  keepCellSubject,
  keepMainSubject,
  pickByMotion,
  provenanceXmp,
  removeFlatBackground,
  toRgba,
} from "./lib";

const ROOT = path.resolve(import.meta.dirname, "../..");
const STAGING = path.join(ROOT, ".art-staging");
const OUT = process.env.ART_OUT ?? path.join(ROOT, "src/assets/site-art");
const REGISTRY = path.join(OUT, "art.json");

type Source =
  | { type: "image"; path: string; crop?: [number, number, number, number] }
  | {
      type: "sheet-cell";
      path: string;
      cols: number;
      rows: number;
      col: number;
      row: number;
      /** Margin around the cell, as a fraction of its size, cut along with it. */
      bleed?: number;
    }
  | {
      type: "video";
      path: string;
      /** Frames in the strip, picked for even motion. */
      frames: number;
      /** Keyframe images that replace the video's first and last frames. */
      start?: string;
      end?: string;
      /** Inclusive video frame ranges never to use. */
      skip?: [number, number][];
      /**
       * Video frame indices to use, in strip order, chosen by eye (see
       * frames.ts); a frame may come out of video order (a blink, then eyes
       * open again). Replaces the even-motion pick; the last index may be the
       * end keyframe's.
       */
      pick?: number[];
    };

type Meta = Record<string, unknown> & { model: string };

type Entry = {
  id: string;
  folder: string;
  kind: "sticker" | "scene" | "cover" | "living";
  source: Source;
  removeBackground?: boolean;
  /** Die-cut edge radius in output px; 0 for none. */
  dieCut?: number;
  /**
   * The subject is cut off flat along its bottom on purpose (an animal
   * peeking over an edge): the die-cut edge goes round the rest only.
   */
  openBottom?: boolean;
  /** Strokes thinner than about twice this (px), such as whiskers, end at the die-cut edge. */
  dieCutOpen?: number;
  /**
   * A living illustration that sits on a line: every frame's subject is moved
   * down onto the strip's bottom edge, so the animal never hovers above it.
   */
  ground?: boolean;
  /** Long edge of the output (of one frame, for a living illustration). */
  maxEdge: number;
  quality?: number;
  meta: Meta;
};

const manifest: Entry[] = JSON.parse(
  readFileSync(
    process.env.ART_MANIFEST ?? path.join(STAGING, "manifest.json"),
    "utf8"
  )
);
const only = new Set(process.argv.slice(2));

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Bounding box of pixels with alpha above `t`, with a margin. */
function alphaBox(img: Rgba, t = 10, margin = 2) {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]! > t) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error("empty image after background removal");
  x0 = Math.max(0, x0 - margin);
  y0 = Math.max(0, y0 - margin);
  x1 = Math.min(img.width - 1, x1 + margin);
  y1 = Math.min(img.height - 1, y1 + margin);
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * True when a fair share of the image is already transparent: the model drew
 * on nothing, so there is no painted background to remove (and a flood fill
 * from the edges would eat dark subjects that match transparent black).
 */
function hasTransparency({ data }: Rgba): boolean {
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 16) clear++;
  return clear / (data.length / 4) > 0.2;
}

/**
 * True when the subject reaches the left, right or top edge of a video frame
 * where the first frame does not (the ground line may meet the bottom, and a
 * wall the keyframe already runs off the edge is part of the set): more than
 * a few newly solid pixels in the outermost two rows or columns.
 */
function touchesFrameEdge({ data, width, height }: Rgba, first: Rgba): boolean {
  let solid = 0;
  const at = (x: number, y: number) => {
    const a = (y * width + x) * 4 + 3;
    if (data[a]! > 128 && first.data[a]! <= 128) solid++;
  };
  for (let y = 0; y < height; y++) {
    for (const x of [0, 1, width - 2, width - 1]) at(x, y);
  }
  for (let x = 2; x < width - 2; x++) {
    at(x, 0);
    at(x, 1);
  }
  return solid > 6;
}

/** True when nearly all of the outermost pixels are already transparent. */
function transparentBorder({ data, width, height }: Rgba): boolean {
  let clear = 0;
  let total = 0;
  const at = (x: number, y: number) => {
    total++;
    if (data[(y * width + x) * 4 + 3]! < 16) clear++;
  };
  for (let x = 0; x < width; x++) {
    at(x, 0);
    at(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    at(0, y);
    at(width - 1, y);
  }
  return clear / total > 0.9;
}

async function cropRgba(
  img: Rgba,
  box: { left: number; top: number; width: number; height: number }
) {
  return toRgba(fromRgba(img).extract(box));
}

/**
 * Cuts the columns from left to left + width and the `height` rows that end
 * at `bottom`, padding with transparent rows where they would start above the
 * image.
 */
async function cropUp(
  img: Rgba,
  left: number,
  width: number,
  bottom: number,
  height: number
) {
  const top = Math.max(0, bottom - height);
  const cut = await cropRgba(img, { left, top, width, height: bottom - top });
  const missing = height - cut.height;
  if (!missing) return cut;
  return toRgba(
    fromRgba(cut).extend({
      top: missing,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
  );
}

type Box = { left: number; top: number; width: number; height: number };

/**
 * Loads an entry's still source. A sheet cell is cut with a bleed margin (a
 * subject may cross its cell line) and returns where the cell proper sits
 * inside the cut, for keepCellSubject.
 */
async function loadSource(entry: Entry): Promise<{ img: Sharp; cell?: Box }> {
  const src = entry.source;
  if (src.type === "video") throw new Error("video handled separately");
  const file = path.join(STAGING, src.path);
  const meta = await sharp(file).metadata();
  const W = meta.width!;
  const H = meta.height!;
  if (src.type === "image") {
    if (!src.crop) return { img: sharp(file) };
    const [x, y, w, h] = src.crop;
    return {
      img: sharp(file).extract({
        left: Math.round(x * W),
        top: Math.round(y * H),
        width: Math.round(w * W),
        height: Math.round(h * H),
      }),
    };
  }
  const cw = W / src.cols;
  const ch = H / src.rows;
  const bleed = src.bleed ?? 0.15;
  const x0 = Math.round(src.col * cw);
  const y0 = Math.round(src.row * ch);
  const left = Math.max(0, Math.round(x0 - bleed * cw));
  const top = Math.max(0, Math.round(y0 - bleed * ch));
  const right = Math.min(W, Math.round(x0 + cw + bleed * cw));
  const bottom = Math.min(H, Math.round(y0 + ch + bleed * ch));
  return {
    img: sharp(file).extract({
      left,
      top,
      width: right - left,
      height: bottom - top,
    }),
    cell: {
      left: x0 - left,
      top: y0 - top,
      width: Math.round(cw),
      height: Math.round(ch),
    },
  };
}

async function encode(
  img: Sharp,
  entry: Entry,
  alpha: boolean
): Promise<Buffer> {
  return img
    .withXmp(provenanceXmp(entry.meta.model))
    .webp({
      quality: entry.quality ?? (alpha ? 86 : 82),
      alphaQuality: 95,
      effort: 6,
      smartSubsample: true,
    })
    .toBuffer();
}

async function buildStill(entry: Entry) {
  const source = await loadSource(entry);
  let img = await toRgba(source.img);
  if (entry.removeBackground) {
    // Generations asked for a transparent background usually arrive with
    // one; only a flat painted background needs removing.
    if (!hasTransparency(img) && !transparentBorder(img))
      img = removeFlatBackground(img);
    const kept = source.cell
      ? keepCellSubject(img, source.cell)
      : keepMainSubject(img, 0.015);
    if (kept.dropped)
      console.warn(`  ${entry.id}: dropped ${kept.dropped} stray part(s)`);
    img = await cropRgba(kept.img, alphaBox(kept.img));
  }
  const long = Math.max(img.width, img.height);
  const scale = Math.min(1, entry.maxEdge / long);
  let out = fromRgba(img).resize(
    Math.round(img.width * scale),
    Math.round(img.height * scale),
    {
      kernel: "lanczos3",
    }
  );
  if (entry.dieCut) {
    const before = await toRgba(out);
    let cut = await dieCut(before, entry.dieCut, entry.dieCutOpen ?? 0);
    if (entry.openBottom) {
      // dieCut pads every side alike: drop the bottom padding (the border
      // drawn under the flat cut) so the subject ends flush at the bottom.
      const pad = (cut.width - before.width) / 2;
      cut = await cropRgba(cut, {
        left: 0,
        top: 0,
        width: cut.width,
        height: cut.height - pad,
      });
    }
    out = fromRgba(cut);
  }
  const hasAlpha = Boolean(entry.removeBackground || entry.dieCut);
  if (!hasAlpha) out = out.removeAlpha();
  const buf = await encode(out, entry, hasAlpha);
  const { width, height } = await sharp(buf).metadata();
  return { buf, width: width!, height: height!, frames: null as number | null };
}

async function buildLiving(entry: Entry) {
  const src = entry.source;
  if (src.type !== "video") throw new Error("not a video");
  const tmp = mkdtempSync(path.join(tmpdir(), "foa-living-"));
  try {
    const video = path.join(STAGING, src.path);
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
    const { width: vw, height: vh } = await sharp(files[0]!).metadata();
    // The crisp keyframes stand in for the video's own first and last
    // frames: the strip rests on its last frame, so that one must be sharp.
    const keyframe = (p: string) =>
      toRgba(
        sharp(path.join(STAGING, p))
          .flatten({ background: "#00FF00" })
          .resize(vw, vh, { kernel: "lanczos3" })
      );
    const raw: Rgba[] = await Promise.all(files.map((f) => toRgba(f)));
    if (src.start) raw[0] = await keyframe(src.start);
    if (src.end) raw[raw.length - 1] = await keyframe(src.end);
    const skip = new Set(
      (src.skip ?? []).flatMap(([a, b]) =>
        Array.from({ length: b - a + 1 }, (_, i) => a + i)
      )
    );
    // A frame where the animal runs out of the video's frame (a tail past the
    // edge) would show it cut off flat: never use one.
    const first = chromaKey(raw[0]!);
    const cut = raw.flatMap((f, i) =>
      i > 0 && i < raw.length - 1 && touchesFrameEdge(chromaKey(f), first)
        ? [i]
        : []
    );
    if (src.pick) {
      // Frames picked by eye stay, but a cut one is worth a second look.
      const bad = src.pick.filter((i) => cut.includes(i));
      if (bad.length)
        console.log(
          `  ${entry.id}: picked frames cut by the edge: ${bad.join(",")}`
        );
    } else {
      if (cut.length)
        console.log(
          `  ${entry.id}: skipped frames cut by the edge: ${cut.join(",")}`
        );
      for (const i of cut) skip.add(i);
    }
    const usable = raw.flatMap((f, i) => (skip.has(i) ? [] : [{ f, i }]));
    let all = usable.map(({ f }) => chromaKey(f));
    if (src.start) {
      // The video drifts paler than its keyframe: measure that on its
      // first frames and correct every video frame alike.
      const fix = colourTransfer(all[Math.min(3, all.length - 1)]!, all[0]!);
      const keyframes = new Set([0, ...(src.end ? [raw.length - 1] : [])]);
      all = all.map((f, k) => (keyframes.has(usable[k]!.i) ? f : fix(f)));
    }
    let chosen: number[];
    if (src.pick) {
      chosen = src.pick.map((i) => {
        const k = usable.findIndex((u) => u.i === i);
        if (k === -1)
          throw new Error(
            `${entry.id}: picked frame ${i} is skipped or missing`
          );
        return k;
      });
    } else {
      const distances: number[] = [];
      for (let i = 1; i < all.length; i++)
        distances.push(await frameDistance(all[i - 1]!, all[i]!));
      chosen = pickByMotion(distances, src.frames);
    }
    console.log(
      `  ${entry.id}: video frames ${chosen.map((k) => usable[k]!.i).join(",")}`
    );
    // Clear specks, then one crop for every frame (the union of their
    // subjects) keeps the strip steady.
    const keyed = chosen.map((k) => keepMainSubject(all[k]!, 0.02).img);
    const boxes = keyed.map((k) => alphaBox(k, 40, 4));
    const left = Math.min(...boxes.map((b) => b.left));
    const top = Math.min(...boxes.map((b) => b.top));
    const right = Math.max(...boxes.map((b) => b.left + b.width));
    const bottom = Math.max(...boxes.map((b) => b.top + b.height));
    // On a line (entry.ground), each frame is cut upwards from its own
    // subject's bottom instead, as tall as the tallest subject.
    const box = {
      left,
      top,
      width: right - left,
      height: entry.ground
        ? Math.max(...boxes.map((b) => b.height))
        : bottom - top,
    };
    const scale = Math.min(1, entry.maxEdge / Math.max(box.width, box.height));
    const fw = Math.round(box.width * scale);
    const fh = Math.round(box.height * scale);
    const edge = entry.dieCut ?? 0;
    const frames = await Promise.all(
      keyed.map(async (k, i) => {
        const b = boxes[i]!;
        const cut = entry.ground
          ? await cropUp(k, box.left, box.width, b.top + b.height, box.height)
          : await cropRgba(k, box);
        const small = await toRgba(
          fromRgba(cut).resize(fw, fh, { kernel: "lanczos3" })
        );
        const framed = edge
          ? await dieCut(small, edge, entry.dieCutOpen ?? 0)
          : small;
        return fromRgba(framed).png().toBuffer();
      })
    );
    const pad = edge ? Math.ceil(edge * 1.6) + 2 : 0;
    const cw = fw + pad * 2;
    const chh = fh + pad * 2;
    const strip = sharp({
      create: {
        width: cw * frames.length,
        height: chh,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite(frames.map((input, i) => ({ input, left: i * cw, top: 0 })));
    const buf = await encode(sharp(await strip.png().toBuffer()), entry, true);
    return { buf, width: cw, height: chh, frames: frames.length };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const registry: Record<string, unknown>[] = (() => {
  try {
    return JSON.parse(readFileSync(REGISTRY, "utf8"));
  } catch {
    return [];
  }
})();
const byId = new Map(registry.map((e) => [e.id as string, e]));

for (const entry of manifest) {
  if (only.size && !only.has(entry.id)) continue;
  const built =
    entry.kind === "living"
      ? await buildLiving(entry)
      : await buildStill(entry);
  const file = `${entry.folder}/${entry.id}.webp`;
  mkdirSync(path.join(OUT, entry.folder), { recursive: true });
  writeFileSync(path.join(OUT, file), built.buf);
  byId.set(entry.id, {
    id: entry.id,
    file,
    kind: entry.kind,
    ...entry.meta,
    width: built.width,
    height: built.height,
    frames: built.frames,
    bytes: built.buf.length,
    sha256: sha256(built.buf),
  });
  console.log(
    `${entry.id}: ${file} ${built.width}x${built.height}${built.frames ? ` x${built.frames} frames` : ""} ${(built.buf.length / 1024).toFixed(0)} KiB`
  );
}

const keep = new Set(manifest.map((e) => e.id));
const out = [...byId.values()]
  .filter((e) => keep.has(e.id as string))
  .toSorted((a, b) => String(a.id).localeCompare(String(b.id)));
writeFileSync(REGISTRY, `${JSON.stringify(out, null, 2)}\n`);
console.log(`art.json: ${out.length} entries`);

// Typed static imports, so next/image gets hashed, immutable files with their
// sizes, and an unknown id is a type error (src/lib/art/index.ts).
if (!process.env.ART_OUT) {
  const ident = (id: string) =>
    `art${id.replace(/(?:^|-)([a-z0-9])/g, (_, c: string) => c.toUpperCase())}`;
  const header = [
    "// Generated by scripts/site-art/build.ts from src/assets/site-art/art.json.",
    "// Do not edit: run `pnpm art:build`.",
  ];
  // The ids alone, so content schemas can name an illustration without
  // pulling in the images or the registry.
  const ids = [
    ...header,
    "",
    "export const SITE_ART_IDS = [",
    ...out.map((e) => `  "${String(e.id)}",`),
    "] as const;",
    "",
    "export type SiteArtId = (typeof SITE_ART_IDS)[number];",
    "",
  ];
  const files = [
    ...header,
    'import type { StaticImageData } from "next/image";',
    "",
    ...out.map(
      (e) =>
        `import ${ident(String(e.id))} from "@/assets/site-art/${String(e.file)}";`
    ),
    "",
    'import type { SiteArtId } from "./ids";',
    "",
    "export const ART_FILES: Record<SiteArtId, StaticImageData> = {",
    ...out.map((e) => `  "${String(e.id)}": ${ident(String(e.id))},`),
    "};",
    "",
  ];
  const idsFile = path.join(ROOT, "src/lib/art/ids.ts");
  const filesFile = path.join(ROOT, "src/lib/art/generated.ts");
  writeFileSync(idsFile, ids.join("\n"));
  writeFileSync(filesFile, files.join("\n"));
  console.log("src/lib/art/ids.ts and generated.ts written");
  // In the repo's own format, so `pnpm format:check` (a CI gate job) passes
  // after every build.
  execFileSync("pnpm", ["exec", "oxfmt", REGISTRY, idsFile, filesFile], {
    stdio: "inherit",
  });
  // Load the registry the way the site does (with the ids just written), so
  // a bad entry fails here rather than in a page or a test.
  execFileSync(
    "pnpm",
    ["exec", "tsx", path.join(import.meta.dirname, "check-registry.ts")],
    { stdio: "inherit" }
  );
}
