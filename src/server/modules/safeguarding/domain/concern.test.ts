import { describe, expect, it } from "vitest";

import {
  CONCERN_CATEGORIES,
  DESCRIPTION_MAX,
  parseConcern,
  type Concern,
} from "./concern";

const valid = {
  category: "inappropriate_contact",
  description:
    "  An adult keeps messaging a Class 6 pupil after the contest.  ",
  subjectDetails: "Pupil at a school in Pune",
  subjectAge: 11,
  reporterIsChild: false,
  anonymous: false,
  reporterName: "Asha Rao",
  reporterContact: "asha@example.test",
};

function ok(input: unknown): Concern {
  const result = parseConcern(input);
  if (!result.ok) throw new Error(`refused: ${result.fields.join(", ")}`);
  return result.concern;
}

describe("parseConcern", () => {
  it("takes a full concern and trims its text", () => {
    expect(ok(valid)).toEqual({
      category: "inappropriate_contact",
      description:
        "An adult keeps messaging a Class 6 pupil after the contest.",
      subjectDetails: "Pupil at a school in Pune",
      subjectAge: 11,
      reporterIsChild: false,
      anonymous: false,
      reporterName: "Asha Rao",
      reporterContact: "asha@example.test",
    });
  });

  it("takes the smallest concern: a category and what happened", () => {
    expect(
      ok({
        category: "bullying",
        description: "They laugh at me in the group chat",
        reporterIsChild: true,
        anonymous: true,
      })
    ).toEqual({
      category: "bullying",
      description: "They laugh at me in the group chat",
      subjectDetails: null,
      subjectAge: null,
      reporterIsChild: true,
      anonymous: true,
      reporterName: null,
      reporterContact: null,
    });
  });

  it("drops a name and contact typed before the anonymous box was ticked", () => {
    const concern = ok({ ...valid, anonymous: true });
    expect(concern.anonymous).toBe(true);
    expect(concern.reporterName).toBeNull();
    expect(concern.reporterContact).toBeNull();
  });

  it("treats a report with no name and no contact as anonymous", () => {
    const concern = ok({ ...valid, reporterName: " ", reporterContact: "" });
    expect(concern.anonymous).toBe(true);
  });

  it("keeps a name without a contact, and a contact without a name", () => {
    expect(ok({ ...valid, reporterContact: "" })).toMatchObject({
      anonymous: false,
      reporterName: "Asha Rao",
      reporterContact: null,
    });
    expect(ok({ ...valid, reporterName: undefined })).toMatchObject({
      anonymous: false,
      reporterName: null,
      reporterContact: "asha@example.test",
    });
  });

  it("accepts every category and nothing else", () => {
    for (const category of CONCERN_CATEGORIES) {
      expect(parseConcern({ ...valid, category }).ok, category).toBe(true);
    }
    expect(parseConcern({ ...valid, category: "SAFEGUARDING" })).toEqual({
      ok: false,
      fields: ["category"],
    });
  });

  it("needs a description that isn't blank and isn't too long", () => {
    expect(parseConcern({ ...valid, description: "   " })).toEqual({
      ok: false,
      fields: ["description"],
    });
    expect(
      parseConcern({ ...valid, description: "x".repeat(DESCRIPTION_MAX + 1) })
    ).toEqual({ ok: false, fields: ["description"] });
    expect(
      parseConcern({ ...valid, description: "x".repeat(DESCRIPTION_MAX) }).ok
    ).toBe(true);
  });

  it("takes the child's age only as a whole number under 18", () => {
    for (const subjectAge of [0, 17, null, undefined]) {
      expect(parseConcern({ ...valid, subjectAge }).ok, `${subjectAge}`).toBe(
        true
      );
    }
    for (const subjectAge of [-1, 18, 9.5, "11"]) {
      expect(parseConcern({ ...valid, subjectAge }), `${subjectAge}`).toEqual({
        ok: false,
        fields: ["subjectAge"],
      });
    }
  });

  it("lists every bad field in form order without echoing what was typed", () => {
    const result = parseConcern({
      ...valid,
      reporterContact: "c".repeat(201),
      category: "nope",
      description: "",
    });
    expect(result).toEqual({
      ok: false,
      fields: ["category", "description", "reporterContact"],
    });
    expect(JSON.stringify(result)).not.toContain("ccc");
  });

  it("refuses fields the form doesn't have, such as attachments", () => {
    expect(
      parseConcern({ ...valid, attachment: "data:image/png;base64,AAAA" })
    ).toMatchObject({ ok: false });
  });

  it("refuses something that isn't a form at all", () => {
    expect(parseConcern(null)).toEqual({ ok: false, fields: [] });
    expect(parseConcern("text")).toEqual({ ok: false, fields: [] });
  });
});
