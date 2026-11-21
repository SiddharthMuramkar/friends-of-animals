import { describe, expect, it } from "vitest";

import { parseCompetitionCode } from "./code";

describe("parseCompetitionCode()", () => {
  it("accepts 3 to 6 letters followed by a two-digit year", () => {
    for (const code of ["ART27", "PAWS26", "NEIGH27", "KINDLY30"]) {
      expect(parseCompetitionCode(code)).toEqual({ ok: true, code });
    }
  });

  it("trims and upper-cases what the admin typed", () => {
    expect(parseCompetitionCode("  paws27 ")).toEqual({
      ok: true,
      code: "PAWS27",
    });
  });

  it("refuses codes that don't match the format", () => {
    for (const raw of [
      "",
      "AB27",
      "TOOLONG27",
      "PAWS2027",
      "PAWS7",
      "PA WS27",
      "PAWS-27",
      "27PAWS",
      "PÄWS27",
    ]) {
      expect(parseCompetitionCode(raw)).toEqual({
        ok: false,
        error: "invalid_code",
      });
    }
  });
});
