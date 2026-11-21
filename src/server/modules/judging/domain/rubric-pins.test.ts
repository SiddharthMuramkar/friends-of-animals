import { describe, expect, it } from "vitest";

import { pinRubrics, type RubricVersion } from "./rubric-pins";

type Discipline = "DRAWING" | "PAINTING" | "ESSAY";

function rubric(
  discipline: Discipline,
  version: number,
  status: RubricVersion<Discipline>["status"]
): RubricVersion<Discipline> {
  return { id: `${discipline}-v${version}`, discipline, version, status };
}

describe("pinning a round's rubrics", () => {
  it("pins the published version of every enabled discipline, in order", () => {
    expect(
      pinRubrics<Discipline>(
        ["PAINTING", "DRAWING"],
        [
          rubric("DRAWING", 1, "superseded"),
          rubric("DRAWING", 2, "published"),
          rubric("DRAWING", 3, "draft"),
          rubric("PAINTING", 1, "published"),
        ]
      )
    ).toEqual({
      ok: true,
      pins: [
        { discipline: "PAINTING", rubricId: "PAINTING-v1", version: 1 },
        { discipline: "DRAWING", rubricId: "DRAWING-v2", version: 2 },
      ],
    });
  });

  it("names every enabled discipline without a published rubric", () => {
    expect(
      pinRubrics<Discipline>(
        ["DRAWING", "ESSAY", "PAINTING"],
        [
          rubric("DRAWING", 1, "published"),
          rubric("ESSAY", 1, "draft"),
          rubric("PAINTING", 1, "superseded"),
        ]
      )
    ).toEqual({ ok: false, missing: ["ESSAY", "PAINTING"] });
  });

  it("ignores rubrics of disciplines the competition doesn't enable", () => {
    expect(
      pinRubrics<Discipline>(
        ["DRAWING"],
        [rubric("DRAWING", 4, "published"), rubric("ESSAY", 1, "published")]
      )
    ).toEqual({
      ok: true,
      pins: [{ discipline: "DRAWING", rubricId: "DRAWING-v4", version: 4 }],
    });
  });

  it("takes the newest if two versions ever read as published", () => {
    expect(
      pinRubrics<Discipline>(
        ["DRAWING"],
        [rubric("DRAWING", 2, "published"), rubric("DRAWING", 1, "published")]
      )
    ).toMatchObject({ ok: true, pins: [{ rubricId: "DRAWING-v2" }] });
  });

  it("pins a discipline listed twice once", () => {
    expect(
      pinRubrics<Discipline>(
        ["DRAWING", "DRAWING"],
        [rubric("DRAWING", 1, "published")]
      )
    ).toMatchObject({ ok: true, pins: [{ discipline: "DRAWING" }] });
  });

  it("refuses a competition with no enabled discipline", () => {
    expect(
      pinRubrics<Discipline>([], [rubric("DRAWING", 1, "published")])
    ).toEqual({ ok: false, missing: [] });
  });
});
