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
  /** A post's cover on the public site, its social card and lists (#112). */
  post_cover_1200: { maxEdge: 1200, contentType: "image/webp", quality: 82 },
  /** An image inside a post's body on the public site (#112). */
  post_inline_960: { maxEdge: 960, contentType: "image/webp", quality: 80 },
} as const;

export type DerivativeKind = keyof typeof DERIVATIVE_KINDS;

/**
 * Each kind of derived copy of a video (#86), made by worker-media with
 * ffmpeg (./video-transcode.ts plans their sizes). Neither carries any of
 * the original's metadata.
 */
export const VIDEO_DERIVATIVE_KINDS = {
  /** The copy people watch: H.264 and AAC in MP4, at most 1080p. */
  video_mp4: { contentType: "video/mp4", extension: "mp4" },
  /** One frame of it, shown before it plays. */
  video_poster: { contentType: "image/jpeg", extension: "jpg" },
} as const;

export type VideoDerivativeKind = keyof typeof VIDEO_DERIVATIVE_KINDS;

/** Any stored derivative: an image's copy or a video's. */
export type StoredDerivativeKind = DerivativeKind | VideoDerivativeKind;

/** Every stored derivative kind, for input checks. */
export const STORED_DERIVATIVE_KINDS = [
  ...(Object.keys(DERIVATIVE_KINDS) as DerivativeKind[]),
  ...(Object.keys(VIDEO_DERIVATIVE_KINDS) as VideoDerivativeKind[]),
] as [StoredDerivativeKind, ...StoredDerivativeKind[]];

/** The file extension a derivative of `kind` is stored and served with. */
export function derivativeExtension(kind: StoredDerivativeKind): string {
  return Object.hasOwn(VIDEO_DERIVATIVE_KINDS, kind)
    ? VIDEO_DERIVATIVE_KINDS[kind as VideoDerivativeKind].extension
    : "webp";
}

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
