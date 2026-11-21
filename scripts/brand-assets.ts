// Derives every raster, icon and single-colour SVG in public/brand/ from the
// vector master (SITE.logo.src). The logo is a registered mark: this script
// scales it and centres it on a canvas. The only other changes are the two FOA
// approved in issue #17 (see scripts/brand-logo.ts):
//   - the tiles alone, without the wordmark, at favicon and touch-icon sizes;
//   - all-white and all-black versions.
//
//   pnpm brand:assets
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { SITE } from "../src/lib/site";
import {
  type Artwork,
  type Canvas,
  canvasSvg,
  fullLogo,
  parseMaster,
  singleColour,
  standaloneSvg,
  tilesOnly,
} from "./brand-logo";

const PUBLIC_DIR = new URL("../public/", import.meta.url);
const publicFile = (path: string) =>
  new URL(path.replace(/^\//, ""), PUBLIC_DIR);

const master = parseMaster(readFileSync(publicFile(SITE.logo.src), "utf8"));
const logo = fullLogo(master);
const tiles = tilesOnly(master);

const WHITE = "#FFFFFF";
const BLACK = "#000000";
/** File-name suffix → fill of the single-colour versions FOA approved (#17). */
const SINGLE_COLOURS = { white: WHITE, black: BLACK } as const;

/** Canvas height that fits the artwork exactly when it fills `width`. */
const heightAt = (art: Artwork, width: number) =>
  Math.round((width * art.viewBox.height) / art.viewBox.width);

const renderPng = (art: Artwork, canvas: Canvas): Buffer =>
  new Resvg(canvasSvg(art, canvas, SITE.name), {
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();

/**
 * A transparent square with the artwork filling its width. The tile row is
 * about 2:1, so an opaque square would show bands above and below it: a white
 * box on grey and dark browser tabs.
 */
const square = (size: number): Canvas => ({
  width: size,
  height: size,
  logoWidth: size,
});

/** ICO container holding PNG-encoded frames (supported by every current browser). */
function ico(frames: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);
  const directory = Buffer.alloc(16 * frames.length);
  let offset = header.length + directory.length;
  frames.forEach(({ size, png }, i) => {
    const entry = i * 16;
    directory.writeUInt8(size % 256, entry); // 0 means 256
    directory.writeUInt8(size % 256, entry + 1);
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...frames.map((f) => f.png)]);
}

function write(path: string, data: string | Buffer) {
  writeFileSync(publicFile(path), data);
  console.log(`public${path}`);
}

// Logo PNGs on white, the logo filling the full width.
for (const width of [256, 512, 1024, 2048]) {
  write(
    `/brand/foa-logo-${width}.png`,
    renderPng(logo, {
      width,
      height: heightAt(logo, width),
      logoWidth: width,
      background: WHITE,
    })
  );
}

// Transparent watermarks for stamping onto photos.
const watermark = (art: Artwork): Canvas => ({
  width: 1024,
  height: heightAt(art, 1024),
  logoWidth: 1024,
});
write("/brand/foa-logo-watermark.png", renderPng(logo, watermark(logo)));

// All-white and all-black logos (#17): transparent, letters and paw cut out.
// Each comes as a vector and as a watermark (white for dark photos).
for (const [name, fill] of Object.entries(SINGLE_COLOURS)) {
  const art = singleColour(master, fill);
  write(`/brand/foa-logo-${name}.svg`, standaloneSvg(art, SITE.name) + "\n");
  write(
    `/brand/foa-logo-watermark-${name}.png`,
    renderPng(art, watermark(art))
  );
}

// Favicon: the tiles alone (#17) on a transparent square; the wordmark is
// unreadable at 16–48 px.
write("/brand/favicon.svg", canvasSvg(tiles, square(512), SITE.name) + "\n");
const favicon = ico(
  [16, 32, 48].map((size) => ({ size, png: renderPng(tiles, square(size)) }))
);
write("/brand/favicon.ico", favicon);
write("/favicon.ico", favicon); // browsers and crawlers request /favicon.ico

// iOS home-screen icon: the tiles alone (#17), opaque, with a margin because
// iOS rounds the corners.
write(
  "/brand/apple-touch-icon.png",
  renderPng(tiles, {
    width: 180,
    height: 180,
    logoWidth: 156,
    background: WHITE,
  })
);

// Open Graph / Twitter card preview: the full logo.
write(
  SITE.socialImage,
  renderPng(logo, {
    width: 1200,
    height: 630,
    logoWidth: 640,
    background: WHITE,
  })
);
