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
