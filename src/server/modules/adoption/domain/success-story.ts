// Adoption success stories. The adopter of an adopted animal writes a short
// story and agrees to its publication (consent purpose
// `adoption_success_story`); the adoption coordinator publishes it.
// Withdrawing that consent takes the story down, whoever acts.
//
// Stories are plain text, escaped when shown: no rich text, so no
// sanitiser. The public read never names the adopter.
//
// Pure. Loads under plain Node (the schema builds its enum from the list).

import type { AdoptionApplicationStatus } from "./application-status";

export const ADOPTION_STORY_STATUSES = [
  "draft",
  "published",
  "withdrawn",
] as const;

export type AdoptionStoryStatus = (typeof ADOPTION_STORY_STATUSES)[number];

export type StoryAction = "submit" | "publish" | "withdraw";

export type StoryActor = "adopter" | "coordinator" | "system";

/** The adopter's consent to publication, as the consent record stands now. */
export type StoryConsentState = "given" | "withdrawn" | "none";

export type StoryRefusal =
  | "forbidden_actor"
  | "invalid_transition"
  /** Only the adopter of an adopted animal has a story to tell. */
  | "not_adopted"
  | "consent_required";

export type StoryDecision =
  | { ok: true; to: AdoptionStoryStatus }
  | { ok: false; reason: StoryRefusal };

type Rule = {
  actors: readonly StoryActor[];
  /** `null` is "no story yet". */
  from: readonly (AdoptionStoryStatus | null)[];
  to: AdoptionStoryStatus;
  /** Needs an adopted application and the adopter's current consent. */
  gated: boolean;
};

const RULES: Record<StoryAction, Rule> = {
  // Submitting again edits a draft, or starts over after a withdrawal.
  submit: {
    actors: ["adopter"],
    from: [null, "draft", "withdrawn"],
    to: "draft",
    gated: true,
  },
  publish: {
    actors: ["coordinator"],
    from: ["draft"],
    to: "published",
    gated: true,
  },
  // The system withdraws when the consent.withdrawn event arrives.
  withdraw: {
    actors: ["adopter", "coordinator", "system"],
    from: ["draft", "published"],
    to: "withdrawn",
    gated: false,
  },
};

/** Decides one move of a success story. */
export function decideStoryTransition(input: {
  from: AdoptionStoryStatus | null;
  action: StoryAction;
  actor: StoryActor;
  applicationStatus: AdoptionApplicationStatus;
  consent: StoryConsentState;
}): StoryDecision {
  const rule = RULES[input.action];
  if (!rule.actors.includes(input.actor)) {
    return { ok: false, reason: "forbidden_actor" };
  }
  if (!rule.from.includes(input.from)) {
    return { ok: false, reason: "invalid_transition" };
  }
  if (rule.gated) {
    if (input.applicationStatus !== "adopted") {
      return { ok: false, reason: "not_adopted" };
    }
    if (input.consent !== "given") {
      return { ok: false, reason: "consent_required" };
    }
  }
  return { ok: true, to: rule.to };
}

/**
 * Whether a story may appear on the public stories page. The read model
 * checks consent too, so a story never shows in the moment between a
 * withdrawal and its consumer running.
 */
export function storyIsPublic(story: {
  status: AdoptionStoryStatus;
  consent: StoryConsentState;
}): boolean {
  return story.status === "published" && story.consent === "given";
}

export const STORY_TEXT_MIN = 20;
export const STORY_TEXT_MAX = 2000;

export type StoryTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too_short" | "too_long" };

/**
 * Cleans a story as typed: one kind of line break, no control characters
 * (tabs and line breaks stay), trimmed, then measured.
 */
export function parseStoryText(raw: string): StoryTextResult {
  const text = raw
    .replaceAll(/\r\n?/g, "\n")
    // oxlint-disable-next-line no-control-regex -- stripping them is the point
    .replaceAll(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .trim();
  if (text.length < STORY_TEXT_MIN) return { ok: false, reason: "too_short" };
  if (text.length > STORY_TEXT_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, text };
}
