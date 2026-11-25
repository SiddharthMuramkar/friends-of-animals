import { describe, expect, it } from "vitest";

import { scanOutcome } from "./scan-outcome";
import type { SniffedContentType } from "./sniff";

describe("scanOutcome", () => {
  it("marks a clean file whose bytes match its declared type clean", () => {
    expect(
      scanOutcome({
        declaredType: "image/png",
        sniffedType: "image/png",
        verdict: { verdict: "clean" },
      })
    ).toEqual({ kind: "settled", status: "clean", scanResult: "OK" });
  });

  it("takes a HEIC declared as HEIF, or the other way round: one container, one decoder", () => {
    for (const [declaredType, sniffedType] of [
      ["image/heic", "image/heif"],
      ["image/heif", "image/heic"],
    ] as const) {
      expect(
        scanOutcome({
          declaredType,
          sniffedType,
          verdict: { verdict: "clean" },
        })
      ).toEqual({ kind: "settled", status: "clean", scanResult: "OK" });
    }
    expect(
      scanOutcome({
        declaredType: "image/heic",
        sniffedType: "image/jpeg",
        verdict: { verdict: "clean" },
      })
    ).toMatchObject({ status: "rejected" });
  });

  it("takes MP4, QuickTime and 3GP for each other, but WebM or an image only for itself (#86)", () => {
    const clean = (declaredType: string, sniffedType: SniffedContentType) =>
      scanOutcome({ declaredType, sniffedType, verdict: { verdict: "clean" } });
    for (const [declared, sniffed] of [
      ["video/mp4", "video/quicktime"],
      ["video/quicktime", "video/mp4"],
      ["video/mp4", "video/3gpp"],
      ["video/webm", "video/webm"],
    ] as const) {
      expect(clean(declared, sniffed)).toMatchObject({ status: "clean" });
    }
    for (const [declared, sniffed] of [
      ["video/mp4", "video/webm"],
      ["video/webm", "video/mp4"],
      ["video/mp4", "image/png"],
      ["image/png", "video/mp4"],
      ["application/pdf", "video/mp4"],
    ] as const) {
      expect(clean(declared, sniffed)).toEqual({
        kind: "settled",
        status: "rejected",
        scanResult: "type_mismatch",
      });
    }
  });

  it("quarantines an infected file, naming the signature", () => {
    expect(
      scanOutcome({
        declaredType: "application/pdf",
        sniffedType: null,
        verdict: { verdict: "infected", signature: "Eicar-Test-Signature" },
      })
    ).toEqual({
      kind: "settled",
      status: "quarantined",
      scanResult: "Eicar-Test-Signature",
    });
  });

  it("quarantines an infected file even when its type also mismatches", () => {
    expect(
      scanOutcome({
        declaredType: "image/png",
        sniffedType: "image/jpeg",
        verdict: { verdict: "infected", signature: "Win.Test.EICAR_HDB-1" },
      })
    ).toMatchObject({ status: "quarantined" });
  });

  it("rejects a clean file whose bytes aren't its declared type", () => {
    for (const sniffedType of ["image/jpeg", null] as const) {
      expect(
        scanOutcome({
          declaredType: "image/png",
          sniffedType,
          verdict: { verdict: "clean" },
        })
      ).toEqual({
        kind: "settled",
        status: "rejected",
        scanResult: "type_mismatch",
      });
    }
  });

  it("asks for a retry when the scanner fails, and never passes the file", () => {
    expect(
      scanOutcome({
        declaredType: "image/png",
        sniffedType: "image/png",
        verdict: { verdict: "error", message: "connection refused" },
      })
    ).toEqual({ kind: "retry", message: "connection refused" });
  });
});
