// The shape of each stamped copy: its canvas, where the image sits on it,
// and the box the logo goes in. The plan is the one source of truth for
// these sizes: the sharp adapter in worker-media draws exactly this plan,
// and the in-memory fake reports it, so the two can't drift apart.
//
// Stamping always works on a derived copy (already resized, metadata
// stripped, orientation baked in) and writes a new file. It never enlarges
// an image. The logo is only scaled: its box keeps the master's proportions
// (public/brand/foa-logo.svg), and when the full logo would be narrower
// than `tilesOnlyBelowPx` the tiles alone are used, as FOA approved for
// small sizes in #17.
//
// Placement, size and the tiles threshold are defaults awaiting FOA's design
// sign-off (HR-43); the settings key covers them.
//
// Pure: no I/O, no "server-only".

import type { LogoForm } from "./logo-choice";

export type PixelSize = { width: number; height: number };

/** A box on the canvas, in whole pixels from the top-left corner. */
export type Rect = PixelSize & { left: number; top: number };

export const STAMP_GEOMETRY = {
  /** Height over width of the full logo and of the tiles alone. */
  logoAspect: {
    full: 169.62 / 294.23,
    tiles: 139.57 / 294.23,
  },
  /** Narrower than this, the full logo's wordmark can't be read. */
  tilesOnlyBelowPx: 96,
  /** No stamp is smaller than this. */
  minLogoWidthPx: 40,
  /** Gap between the logo and the canvas edge, as a share of its short edge. */
  marginOfShortEdge: 0.03,
  minMarginPx: 8,
  /** Behind framed images: the site's page background (neutral-50). */
  background: "#FEFAF2",
} as const;

type CanvasRule =
  /** The image itself, shrunk so its long edge is at most `maxEdge`. */
  | { kind: "fit"; maxEdge: number }
  /** A fixed canvas with the image centred inside it. */
  | { kind: "frame"; width: number; height: number };

type VariantRule = {
  canvas: CanvasRule;
  logo: {
    anchor: "bottom-right" | "top-centre";
    /** Full logo width as a share of the canvas's short edge. */
    widthOfShortEdge: number;
  };
  output: { contentType: "image/webp" | "image/jpeg" | "image/png" };
  /** The `file_asset` purpose the stamped copy is stored under. */
  purpose: "stamped_gallery" | "stamped_social" | "certificate_share";
};

/** Each kind of stamped copy, by the name stored with it. */
export const STAMP_VARIANTS = {
  /** The public gallery's full view. */
  gallery: {
    canvas: { kind: "fit", maxEdge: 2048 },
    logo: { anchor: "bottom-right", widthOfShortEdge: 0.2 },
    output: { contentType: "image/webp" },
    purpose: "stamped_gallery",
  },
  /** Gallery grids: stamped on its own, so small sizes get the tiles. */
  gallery_thumb: {
    canvas: { kind: "fit", maxEdge: 480 },
    logo: { anchor: "bottom-right", widthOfShortEdge: 0.2 },
    output: { contentType: "image/webp" },
    purpose: "stamped_gallery",
  },
  /** A square post for FOA's social media. JPEG, which every platform takes. */
  social: {
    canvas: { kind: "frame", width: 1080, height: 1080 },
    logo: { anchor: "bottom-right", widthOfShortEdge: 0.2 },
    output: { contentType: "image/jpeg" },
    purpose: "stamped_social",
  },
  /** A participant's certificate card. PNG keeps the text and QR sharp. */
  certificate_share: {
    canvas: { kind: "frame", width: 1080, height: 1350 },
    logo: { anchor: "top-centre", widthOfShortEdge: 0.36 },
    output: { contentType: "image/png" },
    purpose: "certificate_share",
  },
} as const satisfies Record<string, VariantRule>;

export type StampVariant = keyof typeof STAMP_VARIANTS;

export type StampPlan = {
  variant: StampVariant;
  canvas: PixelSize;
  /** Where the resized image sits. The whole canvas for "fit" variants. */
  image: Rect;
  /** Fills the canvas behind the image; only framed variants show it. */
  background: string;
  /** Where the logo goes, and whether it is the full logo or the tiles. */
  logo: Rect & { form: LogoForm };
};

/** Why an image can't be stamped. */
export class StampPlanError extends Error {
  readonly code: "image_too_small";

  constructor(code: "image_too_small", message: string) {
    super(message);
    this.name = "StampPlanError";
    this.code = code;
  }
}

function assertPixelSize({ width, height }: PixelSize): void {
  for (const edge of [width, height]) {
    if (!Number.isInteger(edge) || edge < 1) {
      throw new RangeError(
        `An image size must be whole positive pixels, got ${width} x ${height}`
      );
    }
  }
}

/** `size` scaled by `scale` (at most 1), never below 1 px. */
function scaled(size: PixelSize, scale: number): PixelSize {
  if (scale >= 1) return { width: size.width, height: size.height };
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

function placeImage(
  source: PixelSize,
  rule: CanvasRule
): { canvas: PixelSize; image: Rect } {
  if (rule.kind === "fit") {
    const canvas = scaled(
      source,
      rule.maxEdge / Math.max(source.width, source.height)
    );
    return { canvas, image: { left: 0, top: 0, ...canvas } };
  }
  const canvas = { width: rule.width, height: rule.height };
  const size = scaled(
    source,
    Math.min(canvas.width / source.width, canvas.height / source.height)
  );
  return {
    canvas,
    image: {
      left: Math.floor((canvas.width - size.width) / 2),
      top: Math.floor((canvas.height - size.height) / 2),
      ...size,
    },
  };
}

function placeLogo(
  canvas: PixelSize,
  rule: VariantRule["logo"]
): StampPlan["logo"] {
  const shortEdge = Math.min(canvas.width, canvas.height);
  const margin = Math.max(
    STAMP_GEOMETRY.minMarginPx,
    Math.round(shortEdge * STAMP_GEOMETRY.marginOfShortEdge)
  );
  const fullWidth = Math.round(shortEdge * rule.widthOfShortEdge);
  const form: LogoForm =
    fullWidth < STAMP_GEOMETRY.tilesOnlyBelowPx ? "tiles" : "full";
  const width = Math.max(STAMP_GEOMETRY.minLogoWidthPx, fullWidth);
  const height = Math.round(width * STAMP_GEOMETRY.logoAspect[form]);
  if (
    width + 2 * margin > canvas.width ||
    height + 2 * margin > canvas.height
  ) {
    throw new StampPlanError(
      "image_too_small",
      `A ${canvas.width} x ${canvas.height} image is too small for a ${width} px logo with ${margin} px margins`
    );
  }
  return rule.anchor === "bottom-right"
    ? {
        form,
        width,
        height,
        left: canvas.width - margin - width,
        top: canvas.height - margin - height,
      }
    : {
        form,
        width,
        height,
        left: Math.floor((canvas.width - width) / 2),
        top: margin,
      };
}

/**
 * The stamped copy of a `source`-sized derived image as `variant`. Throws
 * `StampPlanError` when the image is too small to carry the logo.
 */
export function planStamp(source: PixelSize, variant: StampVariant): StampPlan {
  assertPixelSize(source);
  const rule: VariantRule = STAMP_VARIANTS[variant];
  const { canvas, image } = placeImage(source, rule.canvas);
  return {
    variant,
    canvas,
    image,
    background: STAMP_GEOMETRY.background,
    logo: placeLogo(canvas, rule.logo),
  };
}
