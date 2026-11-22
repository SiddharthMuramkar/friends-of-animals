import { describe, expect, it } from "vitest";

import { rubricCoverage } from "./rubric-coverage";

describe("rubricCoverage()", () => {
  it("is complete when every enabled discipline has a published rubric", () => {
    expect(
      rubricCoverage(
        ["DRAWING", "ESSAY"],
        [
          { discipline: "ESSAY", status: "published" },
          { discipline: "DRAWING", status: "published" },
        ]
      )
    ).toEqual({ complete: true });
  });

  it("names each enabled discipline that has no published rubric", () => {
    expect(
      rubricCoverage(
        ["DRAWING", "ESSAY", "PAINTING"],
        [{ discipline: "DRAWING", status: "published" }]
      )
    ).toEqual({ complete: false, missing: ["ESSAY", "PAINTING"] });
  });

  it("does not count a draft or a superseded version", () => {
    expect(
      rubricCoverage(
        ["DRAWING", "ESSAY"],
        [
          { discipline: "DRAWING", status: "superseded" },
          { discipline: "ESSAY", status: "draft" },
        ]
      )
    ).toEqual({ complete: false, missing: ["DRAWING", "ESSAY"] });
  });

  it("counts a discipline once a newer version is published over an old one", () => {
    expect(
      rubricCoverage(
        ["DRAWING"],
        [
          { discipline: "DRAWING", status: "superseded" },
          { discipline: "DRAWING", status: "published" },
          { discipline: "DRAWING", status: "draft" },
        ]
      )
    ).toEqual({ complete: true });
  });

  it("ignores published rubrics for disciplines the competition no longer enables", () => {
    expect(
      rubricCoverage(
        ["ESSAY"],
        [{ discipline: "DRAWING", status: "published" }]
      )
    ).toEqual({ complete: false, missing: ["ESSAY"] });
  });

  it("names a discipline listed twice only once", () => {
    expect(rubricCoverage(["ESSAY", "ESSAY"], [])).toEqual({
      complete: false,
      missing: ["ESSAY"],
    });
  });
});
