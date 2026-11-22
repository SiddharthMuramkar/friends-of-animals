// What a finished scan means for a file. The scan job does the I/O (read the
// object, stream it to the scanner, sniff its first bytes) and asks this
// what to record. A scanner failure is never a pass: the job retries and the
// file stays undeliverable to anyone but its uploader meanwhile.

import type { ScanVerdict } from "../../../ports/malware-scanner";
import type { SniffedContentType } from "./sniff";

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
      return sniffedType === declaredType
        ? { kind: "settled", status: "clean", scanResult: "OK" }
        : { kind: "settled", status: "rejected", scanResult: "type_mismatch" };
  }
}
