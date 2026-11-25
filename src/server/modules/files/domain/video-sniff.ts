// What kind of video a file really is, from its first bytes. The scan job
// compares this with the type declared at upload, so a "video" that is
// really a script or an image is rejected even when the scanner passes it.
//
// Phones label ISO base media files loosely (an iPhone .mov can arrive as
// video/mp4, an Android 3GP as video/mp4), and ffmpeg reads all of them the
// same way, so MP4, QuickTime and 3GP count as one family.
//
// Pure: no I/O, no "server-only".

export type SniffedVideoType =
  | "video/mp4"
  | "video/quicktime"
  | "video/3gpp"
  | "video/webm";

/** How many leading bytes `sniffVideoType` needs: brands and doc type. */
export const VIDEO_SNIFF_BYTES = 64;

const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "iso7",
  "iso8",
  "iso9",
  "mp41",
  "mp42",
  "avc1",
  "M4V ",
  "M4VP",
  "mmp4",
  "dash",
  "MSNV",
]);
const QUICKTIME_BRAND = "qt  ";
/** Photos (HEIF, AVIF) and audio (M4A) share the container; not video. */
const NOT_VIDEO_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
  "avif",
  "avis",
  "M4A ",
  "M4B ",
  "M4P ",
  "F4A ",
  "F4B ",
]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function brandType(brand: string): SniffedVideoType | null {
  if (brand === QUICKTIME_BRAND) return "video/quicktime";
  if (brand.startsWith("3gp")) return "video/3gpp";
  if (MP4_BRANDS.has(brand)) return "video/mp4";
  return null;
}

function sniffFtyp(bytes: Uint8Array): SniffedVideoType | null {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return null;
  const boxSize = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  ).getUint32(0);
  const major = ascii(bytes, 8, 4);
  if (NOT_VIDEO_BRANDS.has(major)) return null;
  const fromMajor = brandType(major);
  if (fromMajor) return fromMajor;
  // Compatible brands follow the 4-byte minor version, 4 bytes each.
  const end = Math.min(boxSize, bytes.length);
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    const fromCompatible = brandType(ascii(bytes, offset, 4));
    if (fromCompatible) return fromCompatible;
  }
  return null;
}

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const DOC_TYPE_ID = [0x42, 0x82];

/** WebM from an EBML header whose DocType is "webm"; other Matroska is not. */
function sniffWebm(bytes: Uint8Array): SniffedVideoType | null {
  if (!EBML_MAGIC.every((byte, index) => bytes[index] === byte)) return null;
  for (let index = 4; index + 3 < bytes.length; index += 1) {
    if (
      bytes[index] !== DOC_TYPE_ID[0] ||
      bytes[index + 1] !== DOC_TYPE_ID[1]
    ) {
      continue;
    }
    const sizeByte = bytes[index + 2]!;
    // A one-byte EBML size has its top bit set; the doc type is short.
    if ((sizeByte & 0x80) === 0) return null;
    return ascii(bytes, index + 3, sizeByte & 0x7f) === "webm"
      ? "video/webm"
      : null;
  }
  return null;
}

/**
 * The video type `head` (at least the file's first `VIDEO_SNIFF_BYTES`
 * bytes) shows, or null for anything that isn't a video we take.
 */
export function sniffVideoType(head: Uint8Array): SniffedVideoType | null {
  return sniffFtyp(head) ?? sniffWebm(head);
}

const ISO_BASE_MEDIA: ReadonlySet<string> = new Set([
  "video/mp4",
  "video/quicktime",
  "video/3gpp",
]);

/** Whether the declared type and the sniffed one may be the same file. */
export function sameVideoFamily(
  declared: string,
  sniffed: SniffedVideoType | null
): boolean {
  if (sniffed === null) return false;
  if (declared === sniffed) return true;
  return ISO_BASE_MEDIA.has(declared) && ISO_BASE_MEDIA.has(sniffed);
}
