// What a file really is, from its first bytes. The scan job compares this
// with the type declared at upload: a "PNG" that is really HTML or a script
// is rejected even when the malware scanner passes it.

/** The types the platform stores, and so the only ones it needs to spot. */
export type SniffedContentType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "application/pdf";

/** How many leading bytes `sniffContentType` reads. */
export const SNIFF_BYTES = 12;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP", at offset 8
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function startsWith(head: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, i) => head[offset + i] === byte);
}

/** The type `head` (a file's first bytes) shows, or null if none of ours. */
export function sniffContentType(head: Uint8Array): SniffedContentType | null {
  if (startsWith(head, PNG)) return "image/png";
  if (startsWith(head, JPEG)) return "image/jpeg";
  if (startsWith(head, RIFF) && startsWith(head, WEBP, 8)) return "image/webp";
  if (startsWith(head, PDF)) return "application/pdf";
  return null;
}
