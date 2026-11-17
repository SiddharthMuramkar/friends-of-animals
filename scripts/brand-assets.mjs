#!/usr/bin/env node
// Derives every raster and icon in public/brand/ from the vector master
// (public/brand/foa-logo.svg). The logo is a registered mark: this script only
// scales it and places it on a canvas. It never crops, recolours or rearranges.
//
//   npm run brand:assets
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const BRAND = new URL("../public/brand/", import.meta.url);
const PUBLIC = new URL("../public/", import.meta.url);

const master = readFileSync(new URL("foa-logo.svg", BRAND), "utf8");
const [W, H] = master
  .match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  .slice(1)
  .map(Number);
const artwork = master
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replace(/<title>[\s\S]*?<\/title>/, "");

/** The master scaled uniformly to `artWidth`, centred on a width × height canvas. */
function placed({ width, height, artWidth, background }) {
  const s = artWidth / W;
  const x = (width - artWidth) / 2;
  const y = (height - H * s) / 2;
  const bg = background
    ? `<rect width="${width}" height="${height}" fill="${background}"/>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<title>Friends of Animals</title>${bg}` +
    `<g transform="translate(${+x.toFixed(4)} ${+y.toFixed(4)}) scale(${+s.toFixed(6)})">${artwork}</g></svg>`
  );
}

const png = (svg) =>
  new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();

/** ICO container holding PNG-encoded frames (supported by every current browser). */
function ico(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(16 * frames.length);
  let offset = header.length + dir.length;
  frames.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size % 256, o);
    dir.writeUInt8(size % 256, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...frames.map((f) => f.data)]);
}

const out = (name, data) => {
  writeFileSync(new URL(name, BRAND), data);
  console.log(`public/brand/${name}`);
};

// Logo PNGs on white, artwork filling the full width.
for (const width of [256, 512, 1024, 2048]) {
  const height = Math.round((width * H) / W);
  out(
    `foa-logo-${width}.png`,
    png(placed({ width, height, artWidth: width, background: "#FFFFFF" }))
  );
}

// Transparent background, for stamping onto photos (SPEC §7.9).
{
  const width = 1024;
  out(
    "foa-logo-watermark.png",
    png(placed({ width, height: Math.round((width * H) / W), artWidth: width }))
  );
}

// Favicon: the full logo on a white square. Whether the F-O-A tiles may appear
// alone at small sizes is waiting on the owner (see public/brand/README.md).
const faviconSvg = placed({
  width: 512,
  height: 512,
  artWidth: 512,
  background: "#FFFFFF",
});
out("favicon.svg", faviconSvg + "\n");
const favicon = ico(
  [16, 32, 48].map((size) => ({
    size,
    data: png(
      placed({
        width: size,
        height: size,
        artWidth: size,
        background: "#FFFFFF",
      })
    ),
  }))
);
out("favicon.ico", favicon);
writeFileSync(new URL("favicon.ico", PUBLIC), favicon); // browsers and crawlers request /favicon.ico
console.log("public/favicon.ico");

// iOS home-screen icon: opaque, with margin because iOS rounds the corners.
out(
  "apple-touch-icon.png",
  png(placed({ width: 180, height: 180, artWidth: 156, background: "#FFFFFF" }))
);

// Open Graph / Twitter card preview.
out(
  "foa-social-1200x630.png",
  png(
    placed({ width: 1200, height: 630, artWidth: 640, background: "#FFFFFF" })
  )
);
