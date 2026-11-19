/** Pure helpers for the doodle pad (no DOM, unit-tested). */

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/**
 * The pad's logical 4:3 space. Points are stored in these units, not screen
 * pixels, so a resize or a rotation scales the drawing instead of cropping
 * it, and Download saves the whole drawing at this size.
 */
export const PAD: Size = { width: 1200, height: 900 };

/** Where the keyboard cursor starts, whatever the pad's size on screen. */
export const PAD_CENTRE: Point = { x: PAD.width / 2, y: PAD.height / 2 };

/** A pointer position (client px) in pad units, given the pad's box. */
export function toPad(
  clientX: number,
  clientY: number,
  box: { left: number; top: number } & Size
): Point {
  if (box.width <= 0 || box.height <= 0) return { ...PAD_CENTRE };
  return {
    x: ((clientX - box.left) * PAD.width) / box.width,
    y: ((clientY - box.top) * PAD.height) / box.height,
  };
}

/** A pad point as CSS `left`/`top` percentages of the pad's box. */
export function toPercent(at: Point): { left: string; top: string } {
  return {
    left: `${(at.x / PAD.width) * 100}%`,
    top: `${(at.y / PAD.height) * 100}%`,
  };
}

/**
 * The canvas bitmap for a pad shown at `box` CSS px: device pixels, capped
 * at `maxDpr` and at `maxPixels` in all, and the scale from pad units to
 * those pixels (for `setTransform`).
 */
export function bitmapSize(
  box: Size,
  devicePixelRatio: number,
  { maxDpr = 2, maxPixels = 2_500_000 } = {}
): Size & { scaleX: number; scaleY: number } {
  const area = box.width * box.height;
  let dpr = Math.min(devicePixelRatio || 1, maxDpr);
  if (area * dpr * dpr > maxPixels) dpr = Math.sqrt(maxPixels / area);
  const width = Math.max(1, Math.round(box.width * dpr));
  const height = Math.max(1, Math.round(box.height * dpr));
  return {
    width,
    height,
    scaleX: width / PAD.width,
    scaleY: height / PAD.height,
  };
}

const r = (n: number) => Math.round(n * 100) / 100;
const avg = (a: number, b: number) => r((a + b) / 2);

/** perfect-freehand's outline → an SVG path (the README's quadratic form). */
export function outlineToPath(outline: number[][]): string {
  if (outline.length < 4) return "";
  const [p0, p1, p2] = outline as [number[], number[], number[]];
  let d = `M${r(p0[0]!)},${r(p0[1]!)} Q${r(p1[0]!)},${r(p1[1]!)} ${avg(p1[0]!, p2[0]!)},${avg(p1[1]!, p2[1]!)} T`;
  for (let i = 2; i < outline.length - 1; i++) {
    const a = outline[i]!;
    const b = outline[i + 1]!;
    d += `${avg(a[0]!, b[0]!)},${avg(a[1]!, b[1]!)} `;
  }
  return `${d}Z`;
}

// In pad units: about 10 and 40 CSS px on a desktop-sized pad.
const STEP = 15;
const BIG_STEP = 60;
const MOVES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Keyboard stamp cursor, in pad units: arrows move it (Shift = bigger
 * steps), clamped to the pad.
 */
export function moveCursor(
  at: Point,
  key: string,
  shift: boolean,
  box: Size = PAD
): Point | null {
  const move = MOVES[key];
  if (!move) return null;
  const step = shift ? BIG_STEP : STEP;
  return {
    x: Math.min(box.width, Math.max(0, at.x + move[0] * step)),
    y: Math.min(box.height, Math.max(0, at.y + move[1] * step)),
  };
}

export type PointerLike = { pointerId: number; isPrimary: boolean };

/**
 * Which pointer owns the live stroke: the first primary pointer to go down,
 * until it lifts, is cancelled or loses capture. A second finger or a
 * resting palm neither adds points to the stroke nor ends it.
 */
export function strokeOwner() {
  let owner: number | null = null;
  return {
    /** Takes the stroke for a primary pointer; false if it is taken. */
    claim({ pointerId, isPrimary }: PointerLike): boolean {
      if (!isPrimary || owner !== null) return false;
      owner = pointerId;
      return true;
    },
    owns(pointerId: number): boolean {
      return owner === pointerId;
    },
    /** Ends the stroke if this pointer owns it; true if it did. */
    release(pointerId: number): boolean {
      if (owner !== pointerId) return false;
      owner = null;
      return true;
    },
  };
}
