import { describe, expect, it } from "vitest";

import { checkAnswers, type OfferedUse } from "./answers";

const offered: OfferedUse[] = [
  { purpose: "public_display", documentId: "doc-display-v2" },
  { purpose: "social_media", documentId: "doc-social-v1" },
];

describe("checkAnswers", () => {
  it("returns every answer in the offered order with its document", () => {
    expect(
      checkAnswers(offered, {
        social_media: "decline",
        public_display: "give",
      })
    ).toEqual({
      ok: true,
      answers: [
        {
          purpose: "public_display",
          documentId: "doc-display-v2",
          answer: "give",
        },
        {
          purpose: "social_media",
          documentId: "doc-social-v1",
          answer: "decline",
        },
      ],
    });
  });

  it("needs an answer for every offered use", () => {
    expect(checkAnswers(offered, { public_display: "give" })).toEqual({
      ok: false,
      reason: "unanswered",
      purposes: ["social_media"],
    });
  });

  it("refuses uses the competition doesn't offer, participation included", () => {
    expect(
      checkAnswers(offered, {
        public_display: "give",
        social_media: "give",
        participation: "give",
      })
    ).toEqual({
      ok: false,
      reason: "not_offered",
      purposes: ["participation"],
    });
  });

  it("refuses anything but give or decline", () => {
    expect(
      checkAnswers(offered, { public_display: "yes", social_media: true })
    ).toEqual({
      ok: false,
      reason: "invalid_answer",
      purposes: ["public_display", "social_media"],
    });
  });

  it("ignores inherited keys", () => {
    const submitted = Object.create({ social_media: "give" }) as Record<
      string,
      unknown
    >;
    submitted.public_display = "give";
    expect(checkAnswers(offered, submitted)).toMatchObject({
      ok: false,
      reason: "unanswered",
    });
  });

  it("has nothing to ask when no public use is offered", () => {
    expect(checkAnswers([], {})).toEqual({
      ok: false,
      reason: "nothing_offered",
    });
  });
});
