// Which approved logo goes on a stamped image. The logo is a registered
// mark, so stamping only ever picks one of the files FOA approved in #17
// (public/brand/README.md) and scales it: the full-colour logo, the
// all-white or all-black version, or the colour tiles alone at small sizes.
// Nothing here recolours or redraws it.
//
// The choice follows contrast with the area under the logo, measured on the
// stamped image itself:
//   - the colour logo's wordmark is black, so it suits light and mid-tone
//     areas;
//   - the white logo suits dark areas;
//   - the black logo suits very light areas (the README's suggestion);
//   - the tiles alone carry their own colours, and #17 approved them alone
//     and the one-colour versions separately, never combined, so small
//     stamps always use the colour tiles.
//
// The thresholds are defaults awaiting FOA's design sign-off of placement
// and contrast (HR-43). The settings key covers them, so changing one
// re-stamps on the next request instead of reusing old copies.
//
// Pure: no I/O, no "server-only", so worker-media and tests can load it.

export const LOGO_VARIANTS = ["colour", "white", "black", "tiles"] as const;

/** One approved logo file. Stored with each stamped copy. */
export type LogoVariant = (typeof LOGO_VARIANTS)[number];

/** The whole logo, or the tiles alone when it would be too small. */
export type LogoForm = "full" | "tiles";

/** What the stamping adapter measures under the logo's box. */
export type RegionLuminance = {
  /** Mean WCAG relative luminance of the area, 0 (black) to 1 (white). */
  meanLuminance: number;
};

export const LOGO_THRESHOLDS = {
  /**
   * Below this luminance white ink contrasts better than black, so the
   * black wordmark of the colour logo would fade: use the white logo. It is
   * the point where the WCAG contrast ratios with white and with black are
   * equal: (1 + 0.05) / (L + 0.05) = (L + 0.05) / 0.05.
   */
  whiteBelow: Math.sqrt(1.05 * 0.05) - 0.05,
  /** From this luminance (about sRGB grey 238) use the black logo. */
  blackFrom: 0.85,
} as const;

/** sRGB byte to linear light, per WCAG 2. */
function linearise(byte: number): number {
  const channel = byte / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

const LINEAR = Float64Array.from({ length: 256 }, (_, byte) => linearise(byte));

/** WCAG 2 relative luminance of one sRGB colour given as bytes. */
export function relativeLuminance(
  red: number,
  green: number,
  blue: number
): number {
  return (
    0.2126 * LINEAR[red]! + 0.7152 * LINEAR[green]! + 0.0722 * LINEAR[blue]!
  );
}

/**
 * Mean relative luminance of raw pixels, `channels` bytes each (RGB or
 * RGBA). Alpha is ignored: the adapter flattens the image onto its
 * background before measuring, so every pixel is opaque.
 */
export function meanLuminance(pixels: Uint8Array, channels: 3 | 4): number {
  if (pixels.length === 0 || pixels.length % channels !== 0) {
    throw new RangeError(
      `Expected whole ${channels}-byte pixels, got ${pixels.length} bytes`
    );
  }
  let total = 0;
  for (let index = 0; index < pixels.length; index += channels) {
    total += relativeLuminance(
      pixels[index]!,
      pixels[index + 1]!,
      pixels[index + 2]!
    );
  }
  return total / (pixels.length / channels);
}

/** The approved logo file for this area and logo size. */
export function chooseLogoVariant(
  region: RegionLuminance,
  form: LogoForm
): LogoVariant {
  const { meanLuminance: luminance } = region;
  if (!(luminance >= 0 && luminance <= 1)) {
    throw new RangeError(
      `A luminance must be between 0 and 1, got ${luminance}`
    );
  }
  if (form === "tiles") return "tiles";
  if (luminance < LOGO_THRESHOLDS.whiteBelow) return "white";
  if (luminance >= LOGO_THRESHOLDS.blackFrom) return "black";
  return "colour";
}
