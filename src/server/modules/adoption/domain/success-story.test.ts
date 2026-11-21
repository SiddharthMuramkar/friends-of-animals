import { describe, expect, it } from "vitest";

import {
  ADOPTION_STORY_STATUSES,
  type AdoptionStoryStatus,
  decideStoryTransition,
  parseStoryText,
  type StoryAction,
  type StoryActor,
  storyIsPublic,
} from "./success-story";

const ACTIONS: readonly [StoryAction, StoryActor][] = [
  ["submit", "adopter"],
  ["publish", "coordinator"],
  ["withdraw", "adopter"],
  ["withdraw", "coordinator"],
  ["withdraw", "system"],
];

// From the ticket: the adopter shares a story, which is published only with
// their consent; withdrawing consent takes it down. "none" = no story yet.
const TABLE: Record<
  AdoptionStoryStatus | "none",
  Record<StoryAction, AdoptionStoryStatus | "—">
> = {
  none: { submit: "draft", publish: "—", withdraw: "—" },
  draft: { submit: "draft", publish: "published", withdraw: "withdrawn" },
  published: { submit: "—", publish: "—", withdraw: "withdrawn" },
  withdrawn: { submit: "draft", publish: "—", withdraw: "—" },
};

describe("decideStoryTransition", () => {
  it("covers every status in the table", () => {
    expect(
      Object.keys(TABLE)
        .filter((status) => status !== "none")
        .sort()
    ).toEqual([...ADOPTION_STORY_STATUSES].sort());
  });

  for (const [from, row] of Object.entries(TABLE)) {
    for (const [action, actor] of ACTIONS) {
      const expected = row[action];
      it(`${from} + ${action} by the ${actor} → ${expected}`, () => {
        const decision = decideStoryTransition({
          from: from === "none" ? null : (from as AdoptionStoryStatus),
          action,
          actor,
          applicationStatus: "adopted",
          consent: "given",
        });
        expect(decision).toEqual(
          expected === "—"
            ? { ok: false, reason: "invalid_transition" }
            : { ok: true, to: expected }
        );
      });
    }
  }

  it("lets only the adopter submit and only the coordinator publish", () => {
    const wrong: [StoryAction, StoryActor][] = [
      ["submit", "coordinator"],
      ["submit", "system"],
      ["publish", "adopter"],
      ["publish", "system"],
    ];
    for (const [action, actor] of wrong) {
      expect(
        decideStoryTransition({
          from: "draft",
          action,
          actor,
          applicationStatus: "adopted",
          consent: "given",
        })
      ).toEqual({ ok: false, reason: "forbidden_actor" });
    }
  });

  it("takes a story only for an adopted animal", () => {
    for (const applicationStatus of [
      "submitted",
      "in_contact",
      "not_matched",
      "listing_closed",
    ] as const) {
      expect(
        decideStoryTransition({
          from: null,
          action: "submit",
          actor: "adopter",
          applicationStatus,
          consent: "given",
        })
      ).toEqual({ ok: false, reason: "not_adopted" });
    }
  });

  it("refuses to submit or publish without the adopter's current consent", () => {
    for (const consent of ["none", "withdrawn"] as const) {
      expect(
        decideStoryTransition({
          from: "draft",
          action: "publish",
          actor: "coordinator",
          applicationStatus: "adopted",
          consent,
        })
      ).toEqual({ ok: false, reason: "consent_required" });
      expect(
        decideStoryTransition({
          from: null,
          action: "submit",
          actor: "adopter",
          applicationStatus: "adopted",
          consent,
        })
      ).toEqual({ ok: false, reason: "consent_required" });
    }
  });

  it("still takes a story down once consent is withdrawn", () => {
    expect(
      decideStoryTransition({
        from: "published",
        action: "withdraw",
        actor: "system",
        applicationStatus: "adopted",
        consent: "withdrawn",
      })
    ).toEqual({ ok: true, to: "withdrawn" });
  });
});

describe("storyIsPublic", () => {
  it("shows a story only while published and consented to", () => {
    expect(storyIsPublic({ status: "published", consent: "given" })).toBe(true);
    expect(storyIsPublic({ status: "published", consent: "withdrawn" })).toBe(
      false
    );
    expect(storyIsPublic({ status: "published", consent: "none" })).toBe(false);
    expect(storyIsPublic({ status: "draft", consent: "given" })).toBe(false);
    expect(storyIsPublic({ status: "withdrawn", consent: "given" })).toBe(
      false
    );
  });
});

describe("parseStoryText", () => {
  it("keeps the trimmed text with its line breaks", () => {
    expect(
      parseStoryText(
        "  Bruno settled in within a week.\n\nHe loves the park.  "
      )
    ).toEqual({
      ok: true,
      text: "Bruno settled in within a week.\n\nHe loves the park.",
    });
  });

  it("needs at least 20 characters and at most 2000", () => {
    expect(parseStoryText("Too short.")).toEqual({
      ok: false,
      reason: "too_short",
    });
    expect(parseStoryText("x".repeat(20))).toMatchObject({ ok: true });
    expect(parseStoryText("x".repeat(2000))).toMatchObject({ ok: true });
    expect(parseStoryText("x".repeat(2001))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("normalises Windows line endings and drops control characters", () => {
    expect(
      parseStoryText("Line one is here\r\nline two\u0000 is here")
    ).toEqual({ ok: true, text: "Line one is here\nline two is here" });
  });
});
