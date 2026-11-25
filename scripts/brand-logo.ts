// Pure SVG helpers for the registered logo's master (public/brand/foa-logo.svg).
// Used by scripts/brand-assets.ts.
//
// The logo is a registered mark: these only ever scale it, plus the two
// derivations FOA approved in issue #17:
//   - tilesOnly: the F-O-A tiles without the wordmark, for small sizes;
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

/** Whole-pixel tile layout for one square icon size. */
export interface PixelGrid {
  /** The icon's width and height in pixels. */
  size: number;
  tileWidth: number;
  tileHeight: number;
  /** Pixels between neighbouring tiles. */
  gap: number;
  /**
   * Hand-placed letters for sizes where the traced ones are too fine to read:
   * one bitmap per tile ("X" is a white pixel), centred across the tile and
   * `top` pixels below its top edge.
   */
  letters?: { top: number; bitmaps: readonly (readonly string[])[] };
}

/** Each icon size in favicon.ico and its whole-pixel layout. */
export const FAVICON_GRIDS: readonly PixelGrid[] = [
  {
    size: 16,
    tileWidth: 5,
    tileHeight: 7,
    gap: 0,
    // At 16 and 24 px the traced letters are 3–5 px tall and blur away.
    letters: {
      top: 1,
      bitmaps: [
        ["XXX", "X..", "XX.", "X..", "X.."],
        ["XXX", "X.X", "X.X", "X.X", "XXX"],
        [".X.", "X.X", "XXX", "X.X", "X.X"],
      ],
    },
  },
  {
    size: 24,
    tileWidth: 7,
    tileHeight: 10,
    gap: 1,
    letters: {
      top: 2,
      bitmaps: [
        [".XXXX", ".X...", ".XXX.", ".X...", ".X..."],
        // The ring, with a dot for the paw.
        [".XXX.", "X...X", "X.X.X", "X...X", ".XXX."],
        ["..X..", ".X.X.", "X...X", "XXXXX", "X...X"],
      ],
    },
  },
  { size: 32, tileWidth: 10, tileHeight: 15, gap: 1 },
  { size: 48, tileWidth: 15, tileHeight: 22, gap: 1 },
];

/** White 1 px squares for the "X"s of a bitmap, one rect per run. */
function bitmapRects(bitmap: readonly string[], left: number, top: number) {
  return bitmap
    .flatMap((row, y) =>
      [...row.matchAll(/X+/g)].map(
        (run) =>
          `<rect x="${left + (run.index ?? 0)}" y="${top + y}" width="${run[0].length}" height="1"/>`
      )
    )
    .join("");
}

/**
 * The tiles alone (#17), hinted for one small icon size. Each tile, with its
 * letter, is moved and scaled onto whole pixels: a few per cent at most, which
 * nobody can see at 16–48 px. Without it the tile edges and gaps fall between
 * pixels and the colours blur into each other.
 */
export function hintedTiles(
  { inner, tiles, wordmarkElement }: Master,
  { size, tileWidth, tileHeight, gap, letters }: PixelGrid
): Artwork {
  const row = 3 * tileWidth + 2 * gap;
  if (row > size || tileHeight > size) {
    throw new Error(`hintedTiles: the tiles don't fit in ${size} px`);
  }
  const left = Math.floor((size - row) / 2);
  const top = Math.floor((size - tileHeight) / 2);
  let art = inner.replace(wordmarkElement, "");
  if (letters) art = art.replace(pathElement(inner, "letters"), "");
  // Without ids, because the markup is repeated once per tile.
  art = art.replace(/\sid="[^"]*"/g, "").trim();
  const markup = tiles
    .map((t, i) => {
      const x = left + i * (tileWidth + gap);
      const sx = round(tileWidth / t.width, 6);
      const sy = round(tileHeight / t.height, 6);
      const clip = `foa-tile-${size}-${i}`;
      const bitmap = letters?.bitmaps[i];
      return (
        `<clipPath id="${clip}"><rect x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}"/></clipPath>` +
        `<g transform="translate(${x} ${top}) scale(${sx} ${sy}) translate(${-t.x} ${-t.y})">` +
        `<g clip-path="url(#${clip})">${art}</g></g>` +
        (bitmap && letters
          ? `<g fill="#FFF">${bitmapRects(
              bitmap,
              x + Math.floor((tileWidth - bitmap[0].length) / 2),
              top + letters.top
            )}</g>`
          : "")
      );
    })
    .join("");
  return { markup, viewBox: { x: 0, y: 0, width: size, height: size } };
}
