// Writes the media test fixtures in fixtures/media/ (see its README.md for
// what each one is for and where the HEIC comes from). The images are
// synthetic: four flat colour quadrants, so tests can check which way up a
// derivative came out by the colour of one corner. The metadata is what a
// phone would leave in a child's photo: GPS, camera make and model, XMP and
// IPTC. The media pipeline must strip all of it.
//
//   pnpm tsx scripts/media-fixtures.ts
//
// Run it again only to change a fixture; the output is committed.

import { readFileSync, writeFileSync } from "node:fs";

import exifr from "exifr";
import decodeHeic from "heic-decode";
import sharp, { type Exif } from "sharp";

const DIR = new URL("../fixtures/media/", import.meta.url);
const file = (name: string) => new URL(name, DIR);

/** Top left, top right, bottom left, bottom right. */
const QUADRANTS = [
  [220, 30, 30], // red
  [30, 160, 60], // green
  [40, 60, 210], // blue
  [245, 245, 245], // white
] as const;

/** Raw RGB pixels of four flat quadrants. */
function quadrants(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const quadrant = (y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1);
      pixels.set(QUADRANTS[quadrant]!, (y * width + x) * 3);
    }
  }
  return pixels;
}

const raw = (width: number, height: number) =>
  sharp(quadrants(width, height), { raw: { width, height, channels: 3 } });

/** A public landmark (Gateway of India, Mumbai), as a phone writes it. */
const GPS = {
  GPSLatitudeRef: "N",
  GPSLatitude: "18/1 55/1 1920/100",
  GPSLongitudeRef: "E",
  GPSLongitude: "72/1 50/1 49/1",
};

const CAMERA = { Make: "Apple", Model: "iPhone 15 Pro", Software: "17.1" };

const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:creator><rdf:Seq><rdf:li>Fixture Child</rdf:li></rdf:Seq></dc:creator>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

/** One IPTC-IIM dataset: record 2, `tag`, a short ASCII value. */
function iptcDataset(tag: number, value: string): Buffer {
  const text = Buffer.from(value, "ascii");
  return Buffer.concat([
    Buffer.from([0x1c, 0x02, tag, text.length >> 8, text.length & 0xff]),
    text,
  ]);
}

/**
 * An APP13 segment holding IPTC (a Photoshop 8BIM resource 0x0404), the way
 * photo apps write a caption and a by-line. sharp can't write IPTC itself.
 */
function iptcSegment(): Buffer {
  const iptc = Buffer.concat([
    iptcDataset(0x50, "Fixture Child"), // 2:80 By-line
    iptcDataset(0x78, "School art entry"), // 2:120 Caption
  ]);
  const padded = iptc.length % 2 ? Buffer.concat([iptc, Buffer.of(0)]) : iptc;
  const resourceLength = Buffer.alloc(4);
  resourceLength.writeUInt32BE(iptc.length);
  const body = Buffer.concat([
    Buffer.from("Photoshop 3.0\0", "ascii"),
    Buffer.from("8BIM", "ascii"),
    Buffer.from([0x04, 0x04, 0x00, 0x00]), // resource id, empty Pascal name
    resourceLength,
    padded,
  ]);
  const header = Buffer.from([0xff, 0xed, 0, 0]);
  header.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([header, body]);
}

/** `jpeg` with `segment` inserted straight after its SOI marker. */
function insertAfterSoi(jpeg: Buffer, segment: Buffer): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("Not a JPEG");
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

// --- HEIF: point the Exif item at new EXIF data --------------------------

type Box = { type: string; start: number; body: number; end: number };

function boxes(bytes: Buffer, start: number, end: number): Box[] {
  const found: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = bytes.readUInt32BE(at);
    let header = 8;
    if (size === 1) {
      size = Number(bytes.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    found.push({
      type: bytes.toString("latin1", at + 4, at + 8),
      start: at,
      body: at + header,
      end: at + size,
    });
    at += size;
  }
  return found;
}

function child(bytes: Buffer, parent: Box, type: string, skip = 0): Box {
  const box = boxes(bytes, parent.body + skip, parent.end).find(
    (candidate) => candidate.type === type
  );
  if (!box) throw new Error(`No ${type} box in ${parent.type}`);
  return box;
}

function readUInt(bytes: Buffer, at: number, size: number): number {
  return size === 0 ? 0 : bytes.readUIntBE(at, size);
}

/** The item ID of the HEIF file's Exif item. */
function exifItemId(bytes: Buffer, meta: Box): number {
  const iinf = child(bytes, meta, "iinf", 4);
  const version = bytes[iinf.body]!;
  const entries = boxes(bytes, iinf.body + (version === 0 ? 6 : 8), iinf.end);
  for (const infe of entries.filter((box) => box.type === "infe")) {
    const infeVersion = bytes[infe.body]!;
    if (infeVersion < 2) continue;
    const idSize = infeVersion === 2 ? 2 : 4;
    const id = readUInt(bytes, infe.body + 4, idSize);
    const typeAt = infe.body + 4 + idSize + 2;
    if (bytes.toString("latin1", typeAt, typeAt + 4) === "Exif") return id;
  }
  throw new Error("The HEIF file has no Exif item");
}

/**
 * Returns `heif` with its Exif item's data replaced by `exif` (a TIFF block
 * after "Exif\0\0", as sharp's metadata() returns it). The new data goes in
 * an mdat box appended at the end, and the item's one iloc extent is
 * rewritten in place to point at it, so no other offset moves.
 */
function withHeifExif(heif: Buffer, exif: Buffer): Buffer {
  const out = Buffer.from(heif);
  const meta = boxes(out, 0, out.length).find((box) => box.type === "meta");
  if (!meta) throw new Error("The HEIF file has no meta box");
  const target = exifItemId(out, meta);
  // ISO/IEC 23008-12 A.2.1: a 4-byte offset to the TIFF header, then data.
  const payload = Buffer.concat([Buffer.from([0, 0, 0, 6]), exif]);
  const payloadAt = out.length + 8;

  const iloc = child(out, meta, "iloc", 4);
  const version = out[iloc.body]!;
  let at = iloc.body + 4;
  const offsetSize = out[at]! >> 4;
  const lengthSize = out[at]! & 0x0f;
  const baseOffsetSize = out[at + 1]! >> 4;
  const indexSize = version > 0 ? out[at + 1]! & 0x0f : 0;
  at += 2;
  const idSize = version < 2 ? 2 : 4;
  const itemCount = readUInt(out, at, idSize);
  at += idSize;
  for (let item = 0; item < itemCount; item += 1) {
    const id = readUInt(out, at, idSize);
    at += idSize;
    const method = version > 0 ? out.readUInt16BE(at) & 0x0f : 0;
    if (version > 0) at += 2;
    at += 2; // data_reference_index
    const baseOffsetAt = at;
    at += baseOffsetSize;
    const extentCount = out.readUInt16BE(at);
    at += 2;
    if (id === target) {
      if (method !== 0 || extentCount !== 1 || offsetSize < 4) {
        throw new Error("Can't rewrite this Exif item's location");
      }
      if (baseOffsetSize > 0) out.writeUIntBE(0, baseOffsetAt, baseOffsetSize);
      at += indexSize;
      out.writeUIntBE(payloadAt, at, offsetSize);
      out.writeUIntBE(payload.length, at + offsetSize, lengthSize);
      const header = Buffer.alloc(8);
      header.writeUInt32BE(payload.length + 8);
      header.write("mdat", 4, "latin1");
      return Buffer.concat([out, header, payload]);
    }
    at += extentCount * (indexSize + offsetSize + lengthSize);
  }
  throw new Error("The Exif item has no iloc entry");
}

/**
 * The raw EXIF block sharp writes for `exif` and `orientation`, as in a
 * JPEG's APP1. (sharp sets Orientation from its own field, not from `exif`.)
 */
async function exifBlock(exif: Exif, orientation: number): Promise<Buffer> {
  const jpeg = await raw(8, 8)
    .jpeg()
    .withExif(exif)
    .withMetadata({ orientation })
    .toBuffer();
  const { exif: block } = await sharp(jpeg).metadata();
  if (!block) throw new Error("sharp wrote no EXIF");
  return block;
}

// --- Write and check -------------------------------------------------------

async function main() {
  const gpsJpeg = insertAfterSoi(
    await raw(2000, 1500)
      .jpeg({ quality: 80 })
      .withExif({ IFD0: CAMERA, IFD3: GPS })
      .withXmp(XMP)
      .toBuffer(),
    iptcSegment()
  );
  writeFileSync(file("gps.jpg"), gpsJpeg);

  // Stored 600 x 400; Orientation 6 means "turn 90 degrees clockwise to
  // view", so it shows as a 400 x 600 portrait with red at the top right.
  const rotated = await raw(600, 400)
    .jpeg({ quality: 85 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  writeFileSync(file("rotated.jpg"), rotated);

  // A real JPEG cut short in its scan data, as an interrupted upload leaves
  // it: the header still reads, the pixels don't.
  writeFileSync(file("corrupt.jpg"), gpsJpeg.subarray(0, 4096));

  // The upstream HEIC keeps its own Orientation 6, matching its irot box,
  // as an iPhone writes both.
  const heic = withHeifExif(
    readFileSync(file("upstream/hyperframes-rotated-grid.heic")),
    await exifBlock({ IFD0: CAMERA, IFD3: GPS }, 6)
  );
  writeFileSync(file("iphone.heic"), heic);

  const everything = { gps: true, tiff: true, xmp: true, iptc: true };
  const jpegTags = await exifr.parse(gpsJpeg, everything);
  const heicTags = await exifr.parse(heic, everything);
  const decoded = await decodeHeic({ buffer: heic });
  const problems = [
    !jpegTags?.latitude && "gps.jpg has no GPS",
    !jpegTags?.Make && "gps.jpg has no camera make",
    !jpegTags?.creator && "gps.jpg has no XMP creator",
    !jpegTags?.Byline && "gps.jpg has no IPTC by-line",
    !heicTags?.latitude && "iphone.heic has no GPS",
    !heicTags?.Model && "iphone.heic has no camera model",
    heicTags?.Orientation !== "Rotate 90 CW" &&
      "iphone.heic lost its EXIF Orientation 6",
    (decoded.width !== 700 || decoded.height !== 1100) &&
      `iphone.heic decodes to ${decoded.width} x ${decoded.height}`,
  ].filter(Boolean);
  if (problems.length > 0) throw new Error(problems.join("; "));
  console.log(
    "Wrote fixtures/media/: gps.jpg rotated.jpg corrupt.jpg iphone.heic"
  );
}

await main();
