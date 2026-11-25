// A success story (#130): an adopter tells how their animal settled in,
// and FOA shares it on /adopt/stories, but only while the adopter consents.
//
//   new        → draft      the adopter of an adopted animal writes it,
//                           giving consent (adoption_success_story)
//   draft      → published  the coordinator publishes it, only while that
//                           consent is still given
//   draft or published → withdrawn
//                           the adopter withdraws their consent; final
//
// A story never shows the adopter's name or contact: the animal's name and
// the listing organisation's are enough. It is plain text, escaped when
// shown, so it needs no sanitiser.
//
// Pure: loads under plain Node, so the schema can build its pgEnum from
// ADOPTION_STORY_STATUSES.

import { z } from "zod";

export const ADOPTION_STORY_STATUSES = [
  "draft",
  "published",
  "withdrawn",
] as const;

export type AdoptionStoryStatus = (typeof ADOPTION_STORY_STATUSES)[number];

export const STORY_TEXT_MIN_LENGTH = 20;
export const STORY_TEXT_MAX_LENGTH = 2000;

export const storyTextSchema = z
  .string()
  .trim()
  .min(STORY_TEXT_MIN_LENGTH)
  .max(STORY_TEXT_MAX_LENGTH);

export type StoryTransitionRefusal = "invalid_transition" | "consent_required";

/** Whether the coordinator may publish a story now. */
export function decideStoryPublication(input: {
  status: AdoptionStoryStatus;
  consentGiven: boolean;
}): { ok: true } | { ok: false; reason: StoryTransitionRefusal } {
  if (input.status !== "draft") {
    return { ok: false, reason: "invalid_transition" };
  }
  if (!input.consentGiven) return { ok: false, reason: "consent_required" };
  return { ok: true };
}

/** Whether a withdrawal of consent changes the story. */
export function storyEndsOnWithdrawal(status: AdoptionStoryStatus): boolean {
  return status !== "withdrawn";
}

/** Whether the public may read it. */
export function storyIsPublic(status: AdoptionStoryStatus): boolean {
  return status === "published";
}
