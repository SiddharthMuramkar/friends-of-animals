// What a finished scan means for a file. The scan job does the I/O (read the
// object, stream it to the scanner, sniff its first bytes) and asks this
// what to record. A scanner failure is never a pass: the job retries and the
// file stays undeliverable to anyone but its uploader meanwhile.

import type { ScanVerdict } from "../../../ports/malware-scanner";
import type { SniffedContentType } from "./sniff";
import { sameVideoFamily, type SniffedVideoType } from "./video-sniff";

export type ScanOutcome =
  | {
      kind: "settled";
      status: "clean" | "quarantined" | "rejected";
      /** Stored as `file_asset.scan_result`. */
      scanResult: string;
    }
  | { kind: "retry"; message: string };

export function scanOutcome({
  declaredType,
  sniffedType,
  verdict,
}: {
  declaredType: string;
  sniffedType: SniffedContentType | null;
  verdict: ScanVerdict;
}): ScanOutcome {
  switch (verdict.verdict) {
    case "error":
      return { kind: "retry", message: verdict.message };
    case "infected":
      return {
        kind: "settled",
        status: "quarantined",
        scanResult: verdict.signature,
      };
    case "clean":
      return sniffedType !== null && sameType(declaredType, sniffedType)
        ? { kind: "settled", status: "clean", scanResult: "OK" }
        : { kind: "settled", status: "rejected", scanResult: "type_mismatch" };
  }
}

/**
 * HEIC is HEIF with HEVC inside, and a phone may write either brand (#85):
 * the media pipeline decodes both the same way, so either declared type
 * matches either one sniffed.
 */
const HEIF_FAMILY: ReadonlySet<string> = new Set(["image/heic", "image/heif"]);

const VIDEO_TYPES: ReadonlySet<string> = new Set<SniffedVideoType>([
  "video/mp4",
  "video/quicktime",
  "video/3gpp",
  "video/webm",
]);

/**
 * Phones label MP4, QuickTime and 3GP loosely (#86), and ffmpeg reads them
 * the same way, so those three match each other (./video-sniff.ts).
 */
function sameType(declared: string, sniffed: SniffedContentType): boolean {
  if (VIDEO_TYPES.has(sniffed)) {
    return sameVideoFamily(declared, sniffed as SniffedVideoType);
  }
  return (
    declared === sniffed ||
    (HEIF_FAMILY.has(declared) && HEIF_FAMILY.has(sniffed))
  );
}
