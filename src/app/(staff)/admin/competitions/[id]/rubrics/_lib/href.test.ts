import { describe, expect, it } from "vitest";

import { disciplineRubricHref, readOutcome, rubricsHref } from "./href";

const ID = "01938a00-0000-7000-8000-000000000c01";

describe("rubric page links", () => {
  it("point at the competition's rubrics and one discipline", () => {
    expect(rubricsHref(ID)).toBe(`/admin/competitions/${ID}/rubrics`);
    expect(disciplineRubricHref(ID, "essay")).toBe(
      `/admin/competitions/${ID}/rubrics/essay`
    );
  });

  it("carry what happened, and read it back", () => {
    const href = disciplineRubricHref(ID, "drawing", { done: "published" }, 42);
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);

    expect(href).toBe(
      `/admin/competitions/${ID}/rubrics/drawing?done=published&at=42`
    );
    expect(readOutcome(params)).toEqual({ done: "published", at: "42" });
    expect(readOutcome({ refused: "draft_exists", at: "7" })).toEqual({
      refused: "draft_exists",
      at: "7",
    });
  });

  it("ignore anything else in the URL", () => {
    expect(readOutcome({})).toBeNull();
    expect(readOutcome({ done: "deleted" })).toBeNull();
    expect(readOutcome({ refused: "<script>" })).toBeNull();
  });
});
