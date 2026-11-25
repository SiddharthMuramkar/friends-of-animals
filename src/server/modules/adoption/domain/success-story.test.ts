import { describe, expect, it } from "vitest";

import {
  ADOPTION_STORY_STATUSES,
  decideStoryPublication,
  storyEndsOnWithdrawal,
  storyIsPublic,
  storyTextSchema,
} from "./success-story";

describe("the success story machine", () => {
  it("publishes only a draft whose adopter still consents", () => {
    expect(
      decideStoryPublication({ status: "draft", consentGiven: true })
    ).toEqual({ ok: true });
    expect(
      decideStoryPublication({ status: "draft", consentGiven: false })
    ).toEqual({ ok: false, reason: "consent_required" });
    for (const status of ["published", "withdrawn"] as const) {
      for (const consentGiven of [true, false]) {
        expect(decideStoryPublication({ status, consentGiven })).toEqual({
          ok: false,
          reason: "invalid_transition",
        });
      }
    }
  });

  it("ends a draft or published story when consent is withdrawn", () => {
    expect(ADOPTION_STORY_STATUSES.filter(storyEndsOnWithdrawal)).toEqual([
      "draft",
      "published",
    ]);
  });

  it("shows only a published story", () => {
    expect(ADOPTION_STORY_STATUSES.filter(storyIsPublic)).toEqual([
      "published",
    ]);
  });

  it("takes 20 to 2000 characters of text, trimmed", () => {
    expect(storyTextSchema.parse("  Bruno sleeps on the sofa now.  ")).toBe(
      "Bruno sleeps on the sofa now."
    );
    expect(storyTextSchema.safeParse("Too short").success).toBe(false);
    expect(storyTextSchema.safeParse("x".repeat(2001)).success).toBe(false);
  });
});
