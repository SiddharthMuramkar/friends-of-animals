import { describe, expect, it } from "vitest";

import { JUDGING_LEVELS, RUBRIC } from "./judging";
import { SAMPLE_COMPETITIONS } from "./sample";
import { CERTIFICATE_NUMBER, SAMPLE_CERTIFICATE } from "./sample/certificate";

describe("judging", () => {
  it("weights the rubric to 100", () => {
    expect(RUBRIC.reduce((sum, r) => sum + r.weight, 0)).toBe(100);
  });

  it("opens only the school and national levels at first", () => {
    expect(JUDGING_LEVELS.filter((l) => l.active).map((l) => l.key)).toEqual([
      "SCHOOL",
      "NATIONAL",
    ]);
  });
});

describe("sample certificate", () => {
  it("has a valid certificate number", () => {
    expect(SAMPLE_CERTIFICATE.number).toMatch(CERTIFICATE_NUMBER);
    expect("FOA-C-27-9XQ4M2T7KI").not.toMatch(CERTIFICATE_NUMBER);
  });

  it("belongs to a sample competition", () => {
    expect(SAMPLE_COMPETITIONS.map((c) => c.code)).toContain(
      SAMPLE_CERTIFICATE.competitionCode
    );
  });
});
