import { readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type Artwork,
  canvasSvg,
  FAVICON_GRIDS,
  fullLogo,
  hintedTiles,
  type PixelGrid,
  parseMaster,
  singleColour,
  standaloneSvg,
  tilesOnly,
} from "./brand-logo";

const master = parseMaster(
  readFileSync(new URL("../public/brand/foa-logo.svg", import.meta.url), "utf8")
);

/** A minimal master in the same shape as foa-logo.svg. */
const fakeMaster = ({ viewBox = "0 0 34 40", tileY = 0 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><title>t</title>` +
  `<g id="tiles">` +
  [0, 12, 24]
    .map((x) => `<rect x="${x}" y="${tileY}" width="10" height="20"/>`)
    .join("") +
  `</g><path id="letters" fill="#FFF" d="M1 1H2V2Z"/>` +
  `<path id="wordmark" fill="#000" d="M0 30H30V35Z"></path></svg>`;

const RENDER_WIDTH = 1200;

/** RGBA pixels of the artwork on a transparent background. */
function render(art: Artwork) {
  const image = new Resvg(standaloneSvg(art, "test"), {
    fitTo: { mode: "width", value: RENDER_WIDTH },
    font: { loadSystemFonts: false },
  }).render();
  return { width: image.width, height: image.height, pixels: image.pixels };
}

/** Channel values within anti-aliasing rounding of each other. */
const near = (a: number, b: number) => Math.abs(a - b) <= 2;

describe("parseMaster", () => {
  it("rejects a malformed viewBox", () => {
    expect(() => parseMaster(fakeMaster({ viewBox: "0 0 34" }))).toThrow(
      /viewBox/
    );
  });
});

describe("logo master", () => {
  const { tiles, viewBox } = master;

  it("has three tiles of equal size, all aligned at the top", () => {
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      expect(tile.y).toBe(0);
      expect(tile.width).toBe(tiles[0].width);
      expect(tile.height).toBe(tiles[0].height);
    }
  });

  it("spaces the tiles evenly across the full width", () => {
    const gaps = [1, 2].map(
      (i) => tiles[i].x - (tiles[i - 1].x + tiles[i - 1].width)
    );
    expect(gaps[0]).toBeCloseTo(gaps[1], 2);
    expect(tiles[0].x).toBe(viewBox.x);
    expect(tiles[2].x + tiles[2].width).toBeCloseTo(viewBox.width, 2);
  });
});

describe("tilesOnly", () => {
  it("leaves out the wordmark", () => {
    const art = tilesOnly(master);
    expect(art.markup).not.toContain('id="wordmark"');
    expect(art.markup).toContain('id="tiles"');
    expect(art.markup).toContain('id="letters"');
  });

  it("crops the logo master to its tiles", () => {
    const { tiles, viewBox } = master;
    expect(tilesOnly(master).viewBox).toEqual({
      x: viewBox.x,
      y: 0,
      width: viewBox.width,
      height: tiles[0].height,
    });
  });

  it("crops to the tiles' top and bottom edges wherever they sit", () => {
    const art = tilesOnly(parseMaster(fakeMaster({ tileY: 5 })));
    expect(art.viewBox).toEqual({ x: 0, y: 5, width: 34, height: 20 });
    expect(art.markup).not.toContain('id="wordmark"');
  });
});

describe("singleColour", () => {
  // Compare the full-colour logo with the single-colour one pixel by pixel.
  let colour: ReturnType<typeof render>;
  let white: ReturnType<typeof render>;
  let black: ReturnType<typeof render>;
  beforeAll(() => {
    colour = render(fullLogo(master));
    white = render(singleColour(master, "#FFFFFF"));
    black = render(singleColour(master, "#000000"));
  });

  type Kind = "tile" | "letter" | "wordmark" | "empty";
  const TILE_COLOURS = [
    [0xc9, 0x28, 0x27],
    [0x07, 0xac, 0x06],
    [0x2b, 0x41, 0xf0],
  ];

  /** Classifies a pixel of the full-colour render; null on anti-aliased edges. */
  function kindAt(i: number): Kind | null {
    const [r, g, b, a] = colour.pixels.subarray(i, i + 4);
    if (a === 0) return "empty";
    if (a !== 255) return null;
    if (r === 255 && g === 255 && b === 255) return "letter";
    if (r === 0 && g === 0 && b === 0) return "wordmark";
    if (TILE_COLOURS.some(([tr, tg, tb]) => r === tr && g === tg && b === tb))
      return "tile";
    return null;
  }

  it("renders at the same size as the full-colour logo", () => {
    expect([white.width, white.height]).toEqual([colour.width, colour.height]);
    expect([black.width, black.height]).toEqual([colour.width, colour.height]);
  });

  it.each([
    ["#FFFFFF", () => white, 255],
    ["#000000", () => black, 0],
  ])(
    "%s: fills tiles and wordmark, and cuts the letters and paw out",
    (_hex, single, value) => {
      const { pixels } = single();
      const counts: Record<Kind, number> = {
        tile: 0,
        letter: 0,
        wordmark: 0,
        empty: 0,
      };
      // Collect mismatches rather than asserting per pixel (~700k pixels).
      const wrong: string[] = [];
      for (let i = 0; i < colour.pixels.length; i += 4) {
        const kind = kindAt(i);
        if (!kind) continue;
        counts[kind]++;
        const [r, g, b, a] = pixels.subarray(i, i + 4);
        const ok =
          kind === "tile" || kind === "wordmark"
            ? a === 255 && near(r, value) && near(g, value) && near(b, value)
            : a === 0;
        if (!ok && wrong.length < 5)
          wrong.push(`${kind} pixel ${i / 4}: ${[r, g, b, a].join(",")}`);
      }
      expect(wrong).toEqual([]);
      // Every kind of pixel was actually checked.
      for (const count of Object.values(counts))
        expect(count).toBeGreaterThan(1000);
    }
  );
});

describe("hintedTiles", () => {
  /** RGBA pixels of a hinted icon, rendered at its own size. */
  const renderIcon = (grid: PixelGrid) =>
    new Resvg(
      canvasSvg(
        hintedTiles(master, grid),
        { width: grid.size, height: grid.size, logoWidth: grid.size },
        "test"
      ),
      { font: { loadSystemFonts: false } }
    ).render();

  it.each(FAVICON_GRIDS.map((grid) => [grid.size, grid] as const))(
    "centres three distinct tiles on a transparent canvas at %i px",
    (_, grid) => {
      const { size, tileWidth, tileHeight, gap } = grid;
      const { pixels } = renderIcon(grid);
      const left = (size - (3 * tileWidth + 2 * gap)) / 2;
      const top = (size - tileHeight) / 2;
      const pixel = (x: number, y: number) => [
        ...pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
      ];
      const y = Math.ceil(top);
      for (let x = 0; x < size; x++) {
        // The band is vertically centred, without a white matte.
        expect(pixel(x, 0)[3]).toBe(0);
        expect(pixel(x, size - 1)[3]).toBe(0);
        expect(pixel(x, y)[3]).toBe(pixel(size - 1 - x, y)[3]);
      }
      const colours = [
        [0xc9, 0x28, 0x27, 255],
        [0x07, 0xac, 0x06, 255],
        [0x2b, 0x41, 0xf0, 255],
      ];
      colours.forEach((colour, tile) => {
        const x0 = left + tile * (tileWidth + gap);
        expect(pixel(Math.floor(x0 + tileWidth / 2), y)).toEqual(colour);
        // Each tile contains visible light lettering, not a solid block.
        let light = 0;
        for (let yy = y; yy < top + tileHeight; yy++) {
          for (let x = Math.ceil(x0); x < x0 + tileWidth - 1; x++) {
            const [r, g, b, a] = pixel(x, yy);
            if (a === 255 && Math.min(r, g, b) >= 180) light++;
          }
        }
        expect(light).toBeGreaterThan(0);
        if (tile < 2) {
          // Even a half-pixel gutter at 16 px separates the colours.
          expect(
            pixel(Math.floor(x0 + tileWidth + gap / 2), y)[3]
          ).toBeLessThan(255);
        }
      });
    }
  );

  it("ships both ICO copies with the current artwork at every size", () => {
    const ico = readFileSync(new URL("../public/favicon.ico", import.meta.url));
    const brandIco = readFileSync(
      new URL("../public/brand/favicon.ico", import.meta.url)
    );
    expect(brandIco.equals(ico)).toBe(true);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(FAVICON_GRIDS.length);
    FAVICON_GRIDS.forEach((grid, index) => {
      const entry = 6 + index * 16;
      expect(ico[entry]).toBe(grid.size);
      expect(ico[entry + 1]).toBe(grid.size);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(
        ico.subarray(offset, offset + length).equals(renderIcon(grid).asPng())
      ).toBe(true);
    });
  });

  it("refuses tiles that don't fit the icon", () => {
    expect(() =>
      hintedTiles(master, { size: 16, tileWidth: 6, tileHeight: 7, gap: 0 })
    ).toThrow(/fit/);
  });
});
