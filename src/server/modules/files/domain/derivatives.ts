// The derived copies the Files module makes of an image, and their sizes.
// The plan here is the one source of truth for derivative dimensions: the
// media processor resizes to exactly these sizes, and its in-memory fake
// reports the same ones, so the two can't drift apart.
//
// Derivatives are encoded from decoded pixels and never copy the source's
// metadata, so EXIF (location, camera), XMP and IPTC don't survive. The
// orientation is baked into the pixels first, which is why sizes are planned
// from the upright size.
//
// Pure: no I/O, no "server-only", so the worker and tests can load it.

/** Each kind of derived copy, by the name stored with it. */
export const DERIVATIVE_KINDS = {
  /** Lists, cards and the participant's own dashboard. */
  thumb_320: { maxEdge: 320, contentType: "image/webp", quality: 80 },
  /** Staff, verifiers and judges looking at the work. */
  display_1600: { maxEdge: 1600, contentType: "image/webp", quality: 85 },
} as const;

export type DerivativeKind = keyof typeof DERIVATIVE_KINDS;

export type PixelSize = { width: number; height: number };

export type PlannedDerivative = PixelSize & {
  kind: DerivativeKind;
  contentType: (typeof DERIVATIVE_KINDS)[DerivativeKind]["contentType"];
};

/**
 * The size an image shows at once its EXIF orientation is applied:
 * orientations 5 to 8 turn it a quarter, so width and height swap. Anything
 * missing or outside 1 to 8 counts as upright.
 */
export function orientedSize(
  { width, height }: PixelSize,
  orientation?: number
): PixelSize {
  const turnsAQuarter =
    orientation !== undefined &&
    Number.isInteger(orientation) &&
    orientation >= 5 &&
    orientation <= 8;
  return turnsAQuarter ? { width: height, height: width } : { width, height };
}

/**
 * Scales `size` so its long edge is at most `maxEdge`, keeping the aspect
 * ratio and rounding to whole pixels. Never enlarges, never goes below 1 px.
 */
export function fitInside(size: PixelSize, maxEdge: number): PixelSize {
  for (const edge of [size.width, size.height]) {
    if (!Number.isInteger(edge) || edge < 1) {
      throw new RangeError(
        `An image size must be whole positive pixels, got ${size.width} x ${size.height}`
      );
    }
  }
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
  if (scale === 1) return { width: size.width, height: size.height };
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * The derived copies to make of a source image, in the order asked for,
 * each kind once. `source` is the stored pixel size plus its EXIF
 * orientation, as a decoder reports them.
 */
export function planImageDerivatives(
  source: PixelSize & { orientation?: number | undefined },
  kinds: readonly DerivativeKind[]
): PlannedDerivative[] {
  const upright = orientedSize(source, source.orientation);
  return [...new Set(kinds)].map((kind) => {
    const { maxEdge, contentType } = DERIVATIVE_KINDS[kind];
    return { kind, ...fitInside(upright, maxEdge), contentType };
  });
}
