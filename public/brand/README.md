# Friends of Animals logo assets

The FOA logo is a **registered mark**. Use these files as they are. Don't recolour, re-font, crop, stretch or rearrange them. Scale them only.

## Files

| File | Size | Use |
|------|------|-----|
| `foa-logo.svg` | vector, 294.23 × 169.62 viewBox | **The master.** Use it wherever SVG works: the site header, certificates, print. Every other file is generated from it. |
| `foa-logo-256.png` | 256 × 148 | Logo on white, for places that need a PNG (emails, documents, third-party profiles). |
| `foa-logo-512.png` | 512 × 295 | Logo on white. |
| `foa-logo-1024.png` | 1024 × 590 | Logo on white. |
| `foa-logo-2048.png` | 2048 × 1181 | Logo on white, for print and large displays. |
| `foa-logo-watermark.png` | 1024 × 590, transparent | For stamping onto artwork photos (SPEC §7.9, `StampSettings.logoAssetId`). Use it on light or mid-tone areas: the wordmark is black. |
| `favicon.svg` | vector, square | Browser tab icon for modern browsers: the full logo on a white square. |
| `favicon.ico` | 16, 32, 48 px | Browser tab icon fallback. A copy sits at `/favicon.ico` because browsers and crawlers ask for that path. |
| `apple-touch-icon.png` | 180 × 180 | iOS / iPadOS home-screen icon. |
| `foa-social-1200x630.png` | 1200 × 630 | Open Graph / Twitter preview image (`og:image`). |
| `foa-logo-source.png` | 368 × 219 | The original screenshot that the master was traced from. Kept for reference. Don't use it on the site. |

## Colours

Sampled from the source (the most common value in each tile):

| Element | Hex | RGB |
|---------|-----|-----|
| F tile (red) | `#C92827` | 201, 40, 39 |
| O tile (green) | `#07AC06` | 7, 172, 6 |
| A tile (blue) | `#2B41F0` | 43, 65, 240 |
| Letters, ring and paw | `#FFFFFF` | 255, 255, 255 |
| Wordmark | `#000000` | 0, 0, 0 |

## How the master was made

The only source is a 368 × 219 screenshot (`foa-logo-source.png`). The 5 px dark strip on its left is screenshot chrome and was cropped away. Each part was traced as the simplest exact shape that fits the source's sub-pixel edges:

- **Tiles:** three rectangles, measured from edge coverage. They are traced as they appear: the tiles have slightly different widths (91.3, 102.4 and 94.7 units), and the green tile sits 0.5 units lower than the other two.
- **F and A:** straight-edged polygons fitted to the letter edges.
- **O:** two superellipses: the outer one is rotated −1.1°.
- **Paw:** the four toes are ellipses. The pad and the cupped hands are a bitmap trace (potrace) of the source, upsampled 8×.
- **Wordmark:** Helvetica letterforms (outlines from URW Nimbus Sans, a Helvetica clone). Each letter is fitted to the source for position, width and weight, with one shared cap height (21.37) and x-height (13.82). The source's x-height is lower than standard Helvetica's, so it was traced as it is.

Rasterised at the source's scale and overlaid on it, the master differs only along edges. Every pixel that is off by more than 16/255 lies on an edge, and nothing inside a shape changes. The overlay and the difference are in [`docs/brand/trace-diff.png`](../../docs/brand/trace-diff.png).

If FOA can find the original artwork file (AI, CDR, EPS or PDF), replace `foa-logo.svg` with an export of it and regenerate the rest.

## Regenerating

Every PNG, ICO and the favicon SVG are derived from `foa-logo.svg` by scaling only:

```bash
pnpm brand:assets      # scripts/brand-assets.ts, renders with resvg
```

## Waiting on the owner

These two questions need FOA's approval, tracked in [#17](https://github.com/SiddharthMuramkar/friends-of-animals/issues/17). Until they answer, the assets keep the full logo in full colour everywhere:

1. **May the three F-O-A tiles appear alone, without the "Friends of Animals" wordmark, at small sizes such as the favicon?** The favicon currently shows the full logo, and at 16 px the wordmark is just a grey line. If FOA approves, `scripts/brand-assets.ts` can crop to the tiles for the favicon sizes.
2. **Is a single-colour (all-white or all-black) version allowed?** This would help on dark backgrounds and photos, where the black wordmark disappears. Until then the site puts the logo on a white plate in dark mode.
