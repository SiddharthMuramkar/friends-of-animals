// Pure SVG helpers for the registered logo's master (public/brand/foa-logo.svg).
// Used by scripts/brand-assets.ts.
//
// The logo is a registered mark: these only ever scale it, plus the two
// derivations FOA approved in issue #17:
//   - tilesOnly: the F-O-A tiles without the wordmark, for small sizes
//     (with optical hints in the smallest favicon frames);
//   - singleColour: tiles and wordmark in one colour, letters and paw cut out.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** SVG markup in the master's coordinate space, and the box it occupies. */
export interface Artwork {
  markup: string;
  viewBox: Box;
}

/** The parts of foa-logo.svg the derivations need. */
export interface Master {
  viewBox: Box;
  /** The master's markup inside <svg>, without its <title>. */
  inner: string;
  tiles: Box[];
  /** The `d` of the white letters-and-paw path. */
  letters: string;
  /** The `d` of the black wordmark path. */
  wordmark: string;
  /** The whole wordmark <path> element, as it appears in `inner`. */
  wordmarkElement: string;
}

const attribute = (tag: string, name: string): string => {
  const value = tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  if (value === undefined) {
    throw new Error(`${tag.slice(0, 60)}…: missing ${name}`);
  }
  return value;
};

/** A <path> element by id, self-closing or not. */
const pathElement = (svg: string, id: string): string => {
  const element = svg.match(
    new RegExp(`<path[^>]*\\sid="${id}"[^>]*?(?:/>|>[\\s\\S]*?</path>)`)
  )?.[0];
  if (!element) throw new Error(`logo master: no <path id="${id}">`);
  return element;
};

export function parseMaster(svg: string): Master {
  const root = svg.match(/<svg[^>]*>/)?.[0];
  if (!root) throw new Error("logo master: no <svg> element");
  const box = attribute(root, "viewBox")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box.length !== 4 || box.some((v) => !Number.isFinite(v))) {
    throw new Error(`logo master: malformed viewBox "${box.join(" ")}"`);
  }
  const [x, y, width, height] = box;
  const tilesGroup = svg.match(/<g[^>]*\sid="tiles"[^>]*>([\s\S]*?)<\/g>/);
  if (!tilesGroup) throw new Error('logo master: no <g id="tiles">');
  const tiles = (tilesGroup[1].match(/<rect[^>]*>/g) ?? []).map((rect) => ({
    x: Number(attribute(rect, "x")),
    y: Number(attribute(rect, "y")),
    width: Number(attribute(rect, "width")),
    height: Number(attribute(rect, "height")),
  }));
  if (tiles.length !== 3) {
    throw new Error(`logo master: expected 3 tiles, found ${tiles.length}`);
  }
  return {
    viewBox: { x, y, width, height },
    inner: svg
      .replace(/^[\s\S]*?<svg[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .replace(/<title>[\s\S]*?<\/title>/, "")
      .trim(),
    tiles,
    letters: attribute(pathElement(svg, "letters"), "d"),
    wordmark: attribute(pathElement(svg, "wordmark"), "d"),
    wordmarkElement: pathElement(svg, "wordmark"),
  };
}

/** The full logo, unaltered. */
export function fullLogo({ inner, viewBox }: Master): Artwork {
  return { markup: inner, viewBox };
}

/** The F-O-A tiles alone, cropped to the tiles' top and bottom (approved in #17). */
export function tilesOnly({
  inner,
  viewBox,
  tiles,
  wordmarkElement,
}: Master): Artwork {
  const top = Math.min(...tiles.map((t) => t.y));
  const bottom = Math.max(...tiles.map((t) => t.y + t.height));
  return {
    markup: inner.replace(wordmarkElement, "").trim(),
    viewBox: {
      x: viewBox.x,
      y: top,
      width: viewBox.width,
      height: bottom - top,
    },
  };
}

/**
 * The whole logo in one colour (approved in #17): tiles and wordmark in `fill`,
 * the letters and paw cut out of the tiles so the background shows through.
 */
export function singleColour(
  { viewBox, tiles, letters, wordmark }: Master,
  fill: string
): Artwork {
  const { x, y, width, height } = viewBox;
  const mask = `foa-knockout-${fill.replace(/\W/g, "").toLowerCase()}`;
  const rects = tiles
    .map(
      (t) =>
        `<rect x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}"/>`
    )
    .join("");
  return {
    markup:
      `<mask id="${mask}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${width}" height="${height}">` +
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#FFF"/>` +
      `<path fill="#000" d="${letters}"/></mask>` +
      `<g id="tiles" fill="${fill}" mask="url(#${mask})">${rects}</g>` +
      `<path id="wordmark" fill="${fill}" d="${wordmark}"/>`,
    viewBox,
  };
}

const round = (value: number, digits = 4) => +value.toFixed(digits);

/** The artwork as its own SVG file, sized to its viewBox. */
export function standaloneSvg(
  { markup, viewBox }: Artwork,
  title: string
): string {
  const { x, y, width, height } = viewBox;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}">` +
    `<title>${title}</title>${markup}</svg>`
  );
}

export interface Canvas {
  width: number;
  height: number;
  /** Width the artwork is scaled to (uniformly); it is centred on the canvas. */
  logoWidth: number;
  /** Omit for a transparent background. */
  background?: string;
}

/** The artwork scaled to `logoWidth` and centred on a canvas. */
export function canvasSvg(
  { markup, viewBox }: Artwork,
  { width, height, logoWidth, background }: Canvas,
  title: string
): string {
  const scale = logoWidth / viewBox.width;
  const x = (width - logoWidth) / 2 - viewBox.x * scale;
  const y = (height - viewBox.height * scale) / 2 - viewBox.y * scale;
  const fill = background
    ? `<rect width="${width}" height="${height}" fill="${background}"/>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<title>${title}</title>${fill}` +
    `<g transform="translate(${round(x)} ${round(y)}) scale(${round(scale, 6)})">${markup}</g></svg>`
  );
}

/** Optical tile layout for one square icon size. */
export interface PixelGrid {
  /** The icon's width and height in pixels. */
  size: number;
  tileWidth: number;
  tileHeight: number;
  /** Pixels between neighbouring tiles. */
  gap: number;
  /** Use the small-size letter outlines rather than the detailed master. */
  compactLetters?: boolean;
}

/** Each icon size in favicon.ico and its optical layout. */
export const FAVICON_GRIDS: readonly PixelGrid[] = [
  { size: 16, tileWidth: 5, tileHeight: 8, gap: 0.5, compactLetters: true },
  { size: 24, tileWidth: 7, tileHeight: 12, gap: 1.5, compactLetters: true },
  { size: 32, tileWidth: 10, tileHeight: 16, gap: 1 },
  { size: 48, tileWidth: 14, tileHeight: 20, gap: 2 },
];

/**
 * Optical hints for 16 and 24 px, in a 5 × 8 tile. The master's F, round O
 * and angled A are represented by filled outlines, not a pixel font. At
 * these sizes the paw's fine details are below a pixel, so leave the counter
 * clear rather than turn it into a distracting dot. Larger icons use the
 * original letter-and-paw artwork.
 */
const COMPACT_LETTERS = [
  "M1 2H4V3H2V4H3.75V5H2V7H1Z",
  "M2.5 1.9C3.7 1.9 4.35 2.9 4.35 4.5S3.7 7.1 2.5 7.1 .65 6.1 .65 4.5 1.3 1.9 2.5 1.9ZM2.5 3C1.95 3 1.65 3.55 1.65 4.5S1.95 6 2.5 6 3.35 5.45 3.35 4.5 3.05 3 2.5 3Z",
  "M.55 7 2.05 2H2.95L4.45 7H3.35L3 5.8H2L1.65 7ZM2.25 4.8H2.75L2.5 3.7Z",
] as const;

/**
 * The tiles alone (#17), optically fitted to one icon size. The row is
 * exactly centred with visible gutters, even on the smallest canvas.
 * Fractional gutters at 16 and 24 px give the small letters more room
 * without letting the three coloured tiles run into one another.
 */
export function hintedTiles(
  { inner, tiles, wordmarkElement }: Master,
  { size, tileWidth, tileHeight, gap, compactLetters }: PixelGrid
): Artwork {
  const row = 3 * tileWidth + 2 * gap;
  if (row > size || tileHeight > size) {
    throw new Error(`hintedTiles: the tiles don't fit in ${size} px`);
  }
  const left = (size - row) / 2;
  const top = (size - tileHeight) / 2;
  let art = inner.replace(wordmarkElement, "");
  if (compactLetters) art = art.replace(pathElement(inner, "letters"), "");
  // Without ids, because the markup is repeated once per tile.
  art = art.replace(/\sid="[^"]*"/g, "").trim();
  const markup = tiles
    .map((t, i) => {
      const x = left + i * (tileWidth + gap);
      const sx = round(tileWidth / t.width, 6);
      const sy = round(tileHeight / t.height, 6);
      const clip = `foa-tile-${size}-${i}`;
      return (
        `<clipPath id="${clip}"><rect x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}"/></clipPath>` +
        `<g transform="translate(${x} ${top}) scale(${sx} ${sy}) translate(${-t.x} ${-t.y})">` +
        `<g clip-path="url(#${clip})">${art}</g></g>` +
        (compactLetters
          ? `<path fill="#FFF" fill-rule="evenodd" transform="translate(${x} ${top}) scale(${tileWidth / 5} ${tileHeight / 8})" d="${COMPACT_LETTERS[i]}"/>`
          : "")
      );
    })
    .join("");
  return { markup, viewBox: { x: 0, y: 0, width: size, height: size } };
}
