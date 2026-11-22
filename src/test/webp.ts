// Reading WebP containers in tests: their size, and any metadata they carry.
// exifr can't read WebP, so the metadata checks look at the RIFF chunks a
// WebP can hold metadata in, and for the values the fixtures plant. Tests
// only.

/** One RIFF chunk: its four-character id and where its data sits. */
export type WebpChunk = { id: string; start: number; size: number };

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const u24le = (bytes: Uint8Array, at: number) =>
  bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);

/** The chunks of a RIFF WebP file. Throws if it isn't one. */
export function webpChunks(bytes: Uint8Array): WebpChunk[] {
  if (
    bytes.length < 12 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP"
  ) {
    throw new Error("Not a WebP file");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: WebpChunk[] = [];
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true);
    chunks.push({ id: ascii(bytes, at, 4), start: at + 8, size });
    at += 8 + size + (size % 2);
  }
  return chunks;
}

/** The canvas size a WebP file declares. */
export function webpSize(bytes: Uint8Array): { width: number; height: number } {
  const [first] = webpChunks(bytes);
  if (!first) throw new Error("A WebP file with no chunks");
  const at = first.start;
  switch (first.id) {
    case "VP8X":
      return {
        width: u24le(bytes, at + 4) + 1,
        height: u24le(bytes, at + 7) + 1,
      };
    case "VP8L": {
      const bits =
        bytes[at + 1]! |
        (bytes[at + 2]! << 8) |
        (bytes[at + 3]! << 16) |
        (bytes[at + 4]! << 24);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    case "VP8 ": {
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      return {
        width: view.getUint16(at + 6, true) & 0x3fff,
        height: view.getUint16(at + 8, true) & 0x3fff,
      };
    }
    default:
      throw new Error(`A WebP file starting with a ${first.id} chunk`);
  }
}

/** VP8X flag bits for an ICC profile, EXIF and XMP. */
const VP8X_METADATA_FLAGS = 0x20 | 0x08 | 0x04;

/** Values the fixtures plant (scripts/media-fixtures.ts). */
const PLANTED = ["Exif", "xmpmeta", "8BIM", "Apple", "iPhone", "Fixture Child"];

/**
 * What metadata a WebP file holds, by name: its EXIF, XMP and ICCP chunks,
 * VP8X flags that announce them, and any planted value found anywhere in
 * its bytes. Empty when it holds none.
 */
export function webpMetadata(bytes: Uint8Array): string[] {
  const found: string[] = [];
  for (const chunk of webpChunks(bytes)) {
    if (["EXIF", "XMP ", "ICCP"].includes(chunk.id)) found.push(chunk.id);
    if (chunk.id === "VP8X" && bytes[chunk.start]! & VP8X_METADATA_FLAGS) {
      found.push("VP8X metadata flags");
    }
  }
  const text = Buffer.from(bytes).toString("latin1");
  return [...found, ...PLANTED.filter((value) => text.includes(value))];
}

/**
 * The smallest WebP container declaring a `width` x `height` canvas: one
 * VP8X chunk and no image data. Fakes return it; nothing can display it.
 */
export function minimalWebp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode("RIFF"), 0);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(encoder.encode("WEBPVP8X"), 8);
  view.setUint32(16, 10, true);
  for (const [at, value] of [
    [24, width - 1],
    [27, height - 1],
  ] as const) {
    bytes.set([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff], at);
  }
  return bytes;
}
