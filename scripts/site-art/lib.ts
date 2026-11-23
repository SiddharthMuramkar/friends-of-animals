/**
 * Pixel helpers for the site-art pipeline (scripts/site-art/build.ts): flat
 * background removal, die-cut sticker edges, connected components and the
 * IPTC provenance XMP every AI illustration master carries.
 */
import sharp, { type Sharp } from "sharp";

export type Rgba = { data: Buffer; width: number; height: number };

export async function toRgba(input: Sharp | Buffer | string): Promise<Rgba> {
  const img = input instanceof sharp ? input : sharp(input);
  const { data, info } = await img
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function fromRgba({ data, width, height }: Rgba): Sharp {
  return sharp(data, { raw: { width, height, channels: 4 } });
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Median colour of the outermost ring of pixels: the flat background. */
export function borderColour({
  data,
  width,
  height,
}: Rgba): [number, number, number] {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    r.push(data[i]!);
    g.push(data[i + 1]!);
    b.push(data[i + 2]!);
  };
  for (let x = 0; x < width; x += 2) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 2) {
    push(0, y);
    push(width - 1, y);
  }
  return [median(r), median(g), median(b)];
}

function distance(data: Buffer, i: number, bg: readonly number[]): number {
  return Math.max(
    Math.abs(data[i]! - bg[0]!),
    Math.abs(data[i + 1]! - bg[1]!),
    Math.abs(data[i + 2]! - bg[2]!)
  );
}

/**
 * Makes a flat, border-connected background transparent. Pixels flood-filled
 * from the edges within `tolerance` of the border colour go clear; a band of
 * `band` px around the subject gets colour-to-alpha against the background so
 * anti-aliased ink edges keep no light halo on dark pages. Enclosed areas of
 * background colour (between legs, inside a loop of tail) stay opaque: the
 * die-cut sticker edge reads them as sticker paper.
 */
export function removeFlatBackground(
  img: Rgba,
  { tolerance = 26, band = 2 }: { tolerance?: number; band?: number } = {}
): Rgba {
  const { width, height } = img;
  const data = Buffer.from(img.data);
  const bg = borderColour(img);
  const isBg = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const seed = (x: number, y: number) => {
    const p = y * width + x;
    if (isBg[p]) return;
    if (distance(data, p * 4, bg) > tolerance) return;
    isBg[p] = 1;
    queue[tail++] = p;
  };
  for (let x = 0; x < width; x++) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seed(0, y);
    seed(width - 1, y);
  }
  while (head < tail) {
    const p = queue[head++]!;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) seed(x - 1, y);
    if (x < width - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < height - 1) seed(x, y + 1);
  }

  // Distance (in px, up to `band`) from the cleared background, for the edge band.
  const near = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (isBg[p]) continue;
      search: for (let d = 1; d <= band; d++) {
        for (let dy = -d; dy <= d; dy++) {
          for (let dx = -d; dx <= d; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (isBg[ny * width + nx]) {
              near[p] = d;
              break search;
            }
          }
        }
      }
    }
  }

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (isBg[p]) {
      data[i + 3] = 0;
      continue;
    }
    if (!near[p]) continue;
    // GIMP-style colour-to-alpha against the background colour.
    let a = 0;
    for (let c = 0; c < 3; c++) {
      const v = data[i + c]!;
      const b = bg[c]!;
      const ac =
        v > b ? (v - b) / (255 - b || 1) : v < b ? (b - v) / (b || 1) : 0;
      a = Math.max(a, ac);
    }
    a = Math.min(1, Math.max(0, a));
    if (a <= 0.02) {
      data[i + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      const b = bg[c]!;
      data[i + c] = Math.max(
        0,
        Math.min(255, Math.round((data[i + c]! - b) / a + b))
      );
    }
    data[i + 3] = Math.round(a * (data[i + 3]! / 255) * 255);
  }
  return { data, width, height };
}

/**
 * Keys out a green screen by "greenness" (g - max(r, b)), with despill. Works
 * on video frames, whose green drifts darker and grainier than the keyframes'
 * and gains soft shadows: anything clearly green goes, whatever its
 * brightness. None of the animals or props is green.
 */
export function chromaKey(
  img: Rgba,
  { lo = 18, hi = 70 }: { lo?: number; hi?: number } = {}
): Rgba {
  const data = Buffer.from(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const green = g - Math.max(r, b);
    const a = green <= lo ? 1 : green >= hi ? 0 : (hi - green) / (hi - lo);
    if (green > 0) data[i + 1] = Math.max(r, b);
    data[i + 3] = Math.round(a * (data[i + 3]! / 255) * 255);
  }
  return { ...img, data };
}

/**
 * A per-channel colour transfer (histogram matching over opaque pixels) that
 * maps `source`'s colours onto `target`'s. Video models drift paler and
 * cooler than the keyframe they start from; one transfer, measured on the
 * video's first frames against the keyframe, corrects every frame alike.
 */
export function colourTransfer(
  source: Rgba,
  target: Rgba
): (img: Rgba) => Rgba {
  const luts = [0, 1, 2].map((c) => {
    const cdf = (img: Rgba) => {
      const hist = new Float64Array(256);
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3]! < 230) continue;
        hist[img.data[i + c]!]!++;
        n++;
      }
      let run = 0;
      return Array.from(hist, (h) => (run += h) / Math.max(n, 1));
    };
    const s = cdf(source);
    const t = cdf(target);
    const lut = new Uint8Array(256);
    let j = 0;
    for (let v = 0; v < 256; v++) {
      while (j < 255 && t[j]! < s[v]!) j++;
      lut[v] = j;
    }
    return lut;
  });
  return (img) => {
    const data = Buffer.from(img.data);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = luts[0]![data[i]!]!;
      data[i + 1] = luts[1]![data[i + 1]!]!;
      data[i + 2] = luts[2]![data[i + 2]!]!;
    }
    return { ...img, data };
  };
}

/** Mean absolute difference of two same-sized frames' alpha-weighted luma, at low resolution. */
export async function frameDistance(a: Rgba, b: Rgba): Promise<number> {
  const small = async (f: Rgba) =>
    (await fromRgba(f)
      .resize(64, 64, { fit: "fill" })
      .raw()
      .toBuffer()) as Buffer;
  const [x, y] = await Promise.all([small(a), small(b)]);
  let sum = 0;
  for (let i = 0; i < x.length; i += 4) {
    const lx =
      ((x[i]! * 2 + x[i + 1]! * 3 + x[i + 2]!) / 6) * (x[i + 3]! / 255);
    const ly =
      ((y[i]! * 2 + y[i + 1]! * 3 + y[i + 2]!) / 6) * (y[i + 3]! / 255);
    sum += Math.abs(lx - ly) + Math.abs(x[i + 3]! - y[i + 3]!) * 0.5;
  }
  return sum / (x.length / 4);
}

/**
 * Picks `count` frame indices so each step shows about the same amount of
 * change (equal steps along the cumulative motion), always keeping the first
 * and last frame. A flip book driven by scrolling then moves evenly instead
 * of lingering on the still frames.
 */
export function pickByMotion(
  distances: readonly number[],
  count: number
): number[] {
  const cumulative = [0];
  for (const d of distances) cumulative.push(cumulative.at(-1)! + d);
  const total = cumulative.at(-1)!;
  const picks = new Set<number>([0, cumulative.length - 1]);
  for (let k = 1; k < count - 1; k++) {
    const target = (total * k) / (count - 1);
    let best = 0;
    for (let i = 0; i < cumulative.length; i++) {
      if (
        Math.abs(cumulative[i]! - target) < Math.abs(cumulative[best]! - target)
      )
        best = i;
    }
    picks.add(best);
  }
  return [...picks].toSorted((a, b) => a - b);
}

/** Labels 8-connected regions of alpha > threshold; returns component sizes and the label map. */
export function components(
  { data, width, height }: Rgba,
  threshold = 24
): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(width * height).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let p = 0; p < width * height; p++) {
    if (labels[p] !== -1 || data[p * 4 + 3]! <= threshold) continue;
    const label = sizes.length;
    let size = 0;
    labels[p] = label;
    stack.push(p);
    while (stack.length) {
      const q = stack.pop()!;
      size++;
      const x = q % width;
      const y = (q - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (labels[n] === -1 && data[n * 4 + 3]! > threshold) {
            labels[n] = label;
            stack.push(n);
          }
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/**
 * Keeps the largest connected subject (and any part at least `keepRatio` of
 * it, such as a detached feather); clears specks and anything bleeding in from
 * a neighbouring sheet cell. Returns how many sizeable parts were dropped.
 */
export function keepMainSubject(
  img: Rgba,
  keepRatio = 0.06
): { img: Rgba; dropped: number } {
  const { labels, sizes } = components(img);
  if (!sizes.length) return { img, dropped: 0 };
  const largest = Math.max(...sizes);
  const keep = new Set(
    sizes.flatMap((s, i) => (s >= largest * keepRatio ? [i] : []))
  );
  let dropped = 0;
  for (const [i, s] of sizes.entries())
    if (!keep.has(i) && s > largest * 0.01) dropped++;
  return { img: keepOnly(img, labels, keep), dropped };
}

/**
 * Clears every pixel more than `margin` px from a kept part: the dropped
 * parts, and the faint low-alpha ghosts (below the component threshold) that
 * neighbouring sheet cells leave behind, which would otherwise widen the crop
 * and push the subject off-centre. The kept parts' soft edges stay.
 */
function keepOnly(
  img: Rgba,
  labels: Int32Array,
  keep: Set<number>,
  margin = 3
): Rgba {
  const { width, height } = img;
  const n = width * height;
  const kept = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (keep.has(labels[p]!)) kept[p] = 1;
  // Square dilation by `margin`, as two separable passes.
  const rows = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let d = -margin; d <= margin && !on; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < width && kept[y * width + xx]) on = 1;
      }
      rows[y * width + x] = on;
    }
  }
  const data = Buffer.from(img.data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let d = -margin; d <= margin && !on; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < height && rows[yy * width + x]) on = 1;
      }
      if (!on) data[(y * width + x) * 4 + 3] = 0;
    }
  }
  return { ...img, data };
}

/**
 * For a sheet cell cut with a bleed margin around it: keeps every part whose
 * centre lies inside the cell proper, so a subject crossing the cell line
 * stays whole, and drops the rest (the edges of neighbouring cells' subjects,
 * and specks smaller than `speck` of the cell's largest part).
 */
export function keepCellSubject(
  img: Rgba,
  cell: { left: number; top: number; width: number; height: number },
  speck = 24
): { img: Rgba; dropped: number } {
  const { labels, sizes } = components(img);
  const sx = new Float64Array(sizes.length);
  const sy = new Float64Array(sizes.length);
  for (let p = 0; p < labels.length; p++) {
    const l = labels[p]!;
    if (l === -1) continue;
    sx[l] = sx[l]! + (p % img.width);
    sy[l] = sy[l]! + Math.floor(p / img.width);
  }
  const inside = sizes.map((s, i) => {
    const cx = sx[i]! / s;
    const cy = sy[i]! / s;
    return (
      cx >= cell.left &&
      cx < cell.left + cell.width &&
      cy >= cell.top &&
      cy < cell.top + cell.height
    );
  });
  const largest = Math.max(0, ...sizes.filter((_, i) => inside[i]));
  // Specks are measured in pixels, not against the subject: a ring of small
  // dots around a subject is part of the drawing.
  const keep = new Set(
    sizes.flatMap((s, i) => (inside[i] && s >= speck ? [i] : []))
  );
  const dropped = sizes.filter(
    (s, i) => !keep.has(i) && s > largest * 0.01
  ).length;
  return { img: keepOnly(img, labels, keep), dropped };
}

/** Chamfer (3-4) distance, in px, from every pixel to the nearest `seed` pixel. */
function chamfer(
  seed: Uint8Array,
  width: number,
  height: number
): Float64Array {
  const n = width * height;
  const dist = new Float64Array(n);
  for (let p = 0; p < n; p++) dist[p] = seed[p] ? 0 : 1e9;
  const relax = (p: number, q: number, w: number) => {
    const d = dist[q]! + w;
    if (d < dist[p]!) dist[p] = d;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (x > 0) relax(p, p - 1, 3);
      if (y > 0) {
        relax(p, p - width, 3);
        if (x > 0) relax(p, p - width - 1, 4);
        if (x < width - 1) relax(p, p - width + 1, 4);
      }
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const p = y * width + x;
      if (x < width - 1) relax(p, p + 1, 3);
      if (y < height - 1) {
        relax(p, p + width, 3);
        if (x < width - 1) relax(p, p + width + 1, 4);
        if (x > 0) relax(p, p + width - 1, 4);
      }
    }
  }
  for (let p = 0; p < n; p++) dist[p] = dist[p]! / 3;
  return dist;
}

/**
 * Adds a white die-cut border of about `radius` px around the subject (a
 * sticker edge), so ink outlines stay legible on the dark theme. With `open`,
 * strokes thinner than about twice that (whiskers) don't shape the border:
 * they end at it instead of growing white tabs.
 */
export async function dieCut(
  img: Rgba,
  radius: number,
  open = 0
): Promise<Rgba> {
  const pad = Math.ceil(radius * 1.6) + 2;
  const width = img.width + pad * 2;
  const height = img.height + pad * 2;
  const base = fromRgba(img).extend({
    top: pad,
    bottom: pad,
    left: pad,
    right: pad,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  const padded = await base.raw().toBuffer();
  const n = width * height;
  // Measured from the solid body: thin, faint strokes (whiskers) cross the
  // border instead of growing white tabs of their own.
  let seed = new Uint8Array(n);
  for (let p = 0; p < n; p++) seed[p] = padded[p * 4 + 3]! > 160 ? 1 : 0;
  if (open > 0) {
    // Morphological opening: erode, then grow back what survived.
    const clear = new Uint8Array(n);
    for (let p = 0; p < n; p++) clear[p] = seed[p] ? 0 : 1;
    const toClear = chamfer(clear, width, height);
    const core = new Uint8Array(n);
    for (let p = 0; p < n; p++) core[p] = toClear[p]! > open ? 1 : 0;
    const toCore = chamfer(core, width, height);
    const opened = new Uint8Array(n);
    for (let p = 0; p < n; p++)
      opened[p] = seed[p] && toCore[p]! <= open + 0.5 ? 1 : 0;
    seed = opened;
  }
  // An anti-aliased edge at `radius` px: a rounded, even sticker border.
  const dist = chamfer(seed, width, height);
  const alpha = Buffer.alloc(n);
  for (let p = 0; p < n; p++) {
    alpha[p] = Math.round(
      Math.max(0, Math.min(1, radius + 0.5 - dist[p]!)) * 255
    );
  }
  // Nothing of the subject reaches past the paper: whisker tips and colour
  // fringes beyond the white edge are trimmed at it.
  for (let p = 0; p < n; p++) {
    if (padded[p * 4 + 3]! > alpha[p]!) padded[p * 4 + 3] = alpha[p]!;
  }
  const paper = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .raw()
    .toBuffer();
  const sticker = await sharp(paper, { raw: { width, height, channels: 4 } })
    .composite([{ input: padded, raw: { width, height, channels: 4 } }])
    .raw()
    .toBuffer();
  return { data: sticker, width, height };
}

export const DIGITAL_SOURCE_TYPE =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

/** XMP packet marking a master as AI-generated (IPTC DigitalSourceType). */
export function provenanceXmp(model: string): string {
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    Iptc4xmpExt:DigitalSourceType="${DIGITAL_SOURCE_TYPE}">
   <dc:creator><rdf:Seq><rdf:li>Friends of Animals: AI illustration (ElevenLabs, ${model})</rdf:li></rdf:Seq></dc:creator>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}
