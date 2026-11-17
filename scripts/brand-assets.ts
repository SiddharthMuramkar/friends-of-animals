// Derives every raster and icon in public/brand/ from the vector master
// (SITE.logo.src). The logo is a registered mark: this script only scales it
// and centres it on a canvas. It never crops, recolours or rearranges it.
//
//   npm run brand:assets
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { SITE } from "../app/lib/site";

const PUBLIC_DIR = new URL("../public/", import.meta.url);
const publicFile = (path: string) =>
  new URL(path.replace(/^\//, ""), PUBLIC_DIR);

const master = readFileSync(publicFile(SITE.logo.src), "utf8");
const viewBox = master.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
if (!viewBox) {
  throw new Error(
    `${SITE.logo.src}: expected a viewBox of the form "0 0 <width> <height>"`
  );
}
const masterWidth = Number(viewBox[1]);
const masterHeight = Number(viewBox[2]);
const artwork = master
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replace(/<title>[\s\S]*?<\/title>/, "");

const WHITE = "#FFFFFF";

/** Canvas height that fits the logo exactly when it fills `width`. */
const logoHeightAt = (width: number) =>
  Math.round((width * masterHeight) / masterWidth);

interface Canvas {
  width: number;
  height: number;
  /** Width the logo is scaled to (uniformly); it is centred on the canvas. */
  logoWidth: number;
  /** Omit for a transparent background. */
  background?: string;
}

function canvasSvg({ width, height, logoWidth, background }: Canvas): string {
  const scale = logoWidth / masterWidth;
  const x = (width - logoWidth) / 2;
  const y = (height - masterHeight * scale) / 2;
  const fill = background
    ? `<rect width="${width}" height="${height}" fill="${background}"/>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<title>${SITE.name}</title>${fill}` +
    `<g transform="translate(${+x.toFixed(4)} ${+y.toFixed(4)}) scale(${+scale.toFixed(6)})">${artwork}</g></svg>`
  );
}

const renderPng = (canvas: Canvas): Buffer =>
  new Resvg(canvasSvg(canvas), { font: { loadSystemFonts: false } })
    .render()
    .asPng();

/** A square canvas with the logo filling its width. */
const square = (size: number): Canvas => ({
  width: size,
  height: size,
  logoWidth: size,
  background: WHITE,
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
    renderPng({
      width,
      height: logoHeightAt(width),
      logoWidth: width,
      background: WHITE,
    })
  );
}

// Transparent background, for stamping onto photos (SPEC §7.9).
write(
  "/brand/foa-logo-watermark.png",
  renderPng({ width: 1024, height: logoHeightAt(1024), logoWidth: 1024 })
);

// Favicon: the full logo on a white square. Whether the F-O-A tiles may appear
// alone at small sizes is waiting on the owner (issue #17).
write("/brand/favicon.svg", canvasSvg(square(512)) + "\n");
const favicon = ico(
  [16, 32, 48].map((size) => ({ size, png: renderPng(square(size)) }))
);
write("/brand/favicon.ico", favicon);
write("/favicon.ico", favicon); // browsers and crawlers request /favicon.ico

// iOS home-screen icon: opaque, with a margin because iOS rounds the corners.
write(
  "/brand/apple-touch-icon.png",
  renderPng({ width: 180, height: 180, logoWidth: 156, background: WHITE })
);

// Open Graph / Twitter card preview.
write(
  SITE.socialImage,
  renderPng({ width: 1200, height: 630, logoWidth: 640, background: WHITE })
);
