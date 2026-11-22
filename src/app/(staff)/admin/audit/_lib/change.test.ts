import { describe, expect, it } from "vitest";

import { describeChange } from "./change";

const SCHOOL = "01938a00-0000-7000-8000-000000001001";
const judge = { role: "judge", scope: { type: "global" } };
const coordinator = {
  role: "institution_coordinator",
  scope: { type: "institution", id: SCHOOL },
};

describe("describeChange", () => {
  it("reads before and after grant lists as grants, with what changed", () => {
    expect(describeChange([judge], [coordinator, judge])).toEqual({
      kind: "grants",
      before: [judge],
      after: [coordinator, judge],
      added: [coordinator],
      removed: [],
    });
    expect(describeChange([coordinator, judge], [judge])).toEqual({
      kind: "grants",
      before: [coordinator, judge],
      after: [judge],
      added: [],
      removed: [coordinator],
    });
  });

  it("reads an empty list as no grants", () => {
    expect(describeChange([], [judge])).toMatchObject({
      kind: "grants",
      before: [],
      added: [judge],
    });
  });

  it("shows anything else as JSON, and a missing side as nothing", () => {
    expect(describeChange(null, { title: "Paws 2026", open: true })).toEqual({
      kind: "json",
      before: null,
      after: '{\n  "title": "Paws 2026",\n  "open": true\n}',
    });
  });

  it("doesn't take a list of something else for grants", () => {
    expect(describeChange([{ role: "owner" }], [])).toEqual({
      kind: "json",
      before: '[\n  {\n    "role": "owner"\n  }\n]',
      after: "[]",
    });
  });
});
