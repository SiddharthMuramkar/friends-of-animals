// What a file really is, from its first bytes. The scan job compares this
// with the type declared at upload: a "PNG" that is really HTML or a script
// is rejected even when the malware scanner passes it.

import { sniffImageType, type SniffedImageType } from "./image-type";
import { sniffVideoType, type SniffedVideoType } from "./video-sniff";

/** The types the platform stores, and so the only ones it needs to spot. */
export type SniffedContentType =
  | SniffedImageType
  | SniffedVideoType
  | "application/pdf";

/**
 * How many leading bytes `sniffContentType` reads: enough for a HEIF's or
 * a phone video's `ftyp` box, whose compatible brands may name its codec
 * (#85, #86), and a WebM's EBML header.
 */
export const SNIFF_BYTES = 64;

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** The type `head` (a file's first bytes) shows, or null if none of ours. */
export function sniffContentType(head: Uint8Array): SniffedContentType | null {
  if (PDF.every((byte, i) => head[i] === byte)) return "application/pdf";
  return sniffImageType(head) ?? sniffVideoType(head);
}
