import { describe, expect, it } from "vitest";

import { scanOutcome } from "./scan-outcome";

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
