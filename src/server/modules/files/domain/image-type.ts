// What kind of image a file really is, from its first bytes. Browsers often
// send an empty or generic type for HEIC photos, and a declared type is only
// a claim, so the media pipeline decides how to decode from the bytes.
//
// Pure: no I/O, no "server-only".

/** The image types the media pipeline can decode. */
export type SniffedImageType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/heif";

/** HEVC-coded HEIF brands: what iPhones write. */
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx"]);
/** Generic HEIF brands; the codec is named by a compatible brand, if at all. */
const HEIF_BRANDS = new Set(["mif1", "msf1"]);

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((byte, index) => bytes[index] === byte)
  );
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** HEIC or HEIF from an ISO base media `ftyp` box, else null. */
function sniffFtyp(bytes: Uint8Array): SniffedImageType | null {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return null;
  const boxSize =
    ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>>
    0;
  const end = Math.min(boxSize, bytes.length);
  const major = ascii(bytes, 8, 4);
  const compatible: string[] = [];
  // Compatible brands follow the 4-byte minor version, 4 bytes each.
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    compatible.push(ascii(bytes, offset, 4));
  }
  if (HEIC_BRANDS.has(major)) return "image/heic";
  if (!HEIF_BRANDS.has(major)) return null;
  if (compatible.some((brand) => brand === "avif" || brand === "avis")) {
    return null;
  }
  return compatible.some((brand) => HEIC_BRANDS.has(brand))
    ? "image/heic"
    : "image/heif";
}

/**
 * The image type `bytes` start with, or null for anything the pipeline
 * doesn't accept (GIF, AVIF, video, PDF, too few bytes). Pass at least the
 * first 64 bytes of the file; more is fine.
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    return "image/webp";
  }
  return sniffFtyp(bytes);
}
