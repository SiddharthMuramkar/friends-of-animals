import { describe, expect, it } from "vitest";

import {
  assertSocialQueueTransition,
  canEditCaption,
  canTransitionSocialQueueItem,
  SOCIAL_QUEUE_STATUSES,
  SOCIAL_REMOVAL_REASONS,
  SocialQueueTransitionError,
  type SocialActorKind,
  type SocialQueueStatus,
  type SocialRemovalReason,
} from "./status";

// The expected machine, written out by hand from the ticket: a content
// manager queues and marks posted; a pending item leaves the queue by hand
// or when the platform sees consent or the gallery item go. Posted is final:
// a hand-made post is taken down by people, not by the queue.
type Move = readonly [
  SocialQueueStatus | null,
  SocialQueueStatus,
  SocialActorKind,
  SocialRemovalReason | null,
];

const ALLOWED: readonly Move[] = [
  [null, "pending", "content_manager", null],
  ["pending", "posted", "content_manager", null],
  ["pending", "removed", "content_manager", "manual"],
  ["pending", "removed", "system", "consent_withdrawn"],
  ["pending", "removed", "system", "gallery_unpublished"],
];

const FROM: readonly (SocialQueueStatus | null)[] = [
  null,
  "pending",
  "posted",
  "removed",
];
const TO: readonly SocialQueueStatus[] = ["pending", "posted", "removed"];
const BY: readonly SocialActorKind[] = ["content_manager", "system"];
const REASONS: readonly (SocialRemovalReason | null)[] = [
  null,
  "manual",
  "consent_withdrawn",
  "gallery_unpublished",
];

const CASES = FROM.flatMap((from) =>
  TO.flatMap((to) =>
    BY.flatMap((by) => REASONS.map((reason): Move => [from, to, by, reason]))
  )
);

const isAllowed = ([from, to, by, reason]: Move) =>
  ALLOWED.some(
    ([f, t, b, r]) => f === from && t === to && b === by && r === reason
  );

describe("social queue statuses", () => {
  it("declares every status and removal reason the queue will ever need", () => {
    expect(SOCIAL_QUEUE_STATUSES).toEqual(["pending", "posted", "removed"]);
    expect(SOCIAL_REMOVAL_REASONS).toEqual([
      "consent_withdrawn",
      "gallery_unpublished",
      "manual",
    ]);
  });
});

describe("canTransitionSocialQueueItem", () => {
  it.each(CASES.map((move) => [...move, isAllowed(move)] as const))(
    "%s -> %s by %s (reason %s) is allowed: %s",
    (from, to, by, reason, allowed) => {
      expect(canTransitionSocialQueueItem(from, to, by, reason)).toBe(allowed);
    }
  );

  it("refuses a posted item leaving the queue, whoever asks and why", () => {
    for (const by of BY) {
      for (const reason of REASONS) {
        expect(
          canTransitionSocialQueueItem("posted", "removed", by, reason)
        ).toBe(false);
      }
    }
  });
});

describe("assertSocialQueueTransition", () => {
  it("passes an allowed move", () => {
    expect(() =>
      assertSocialQueueTransition(
        "pending",
        "removed",
        "system",
        "consent_withdrawn"
      )
    ).not.toThrow();
  });

  it("throws a SocialQueueTransitionError naming the move", () => {
    let caught: unknown;
    try {
      assertSocialQueueTransition(
        "removed",
        "pending",
        "content_manager",
        null
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SocialQueueTransitionError);
    expect(caught).toMatchObject({
      from: "removed",
      to: "pending",
      by: "content_manager",
      reason: null,
    });
    expect((caught as Error).message).toBe(
      "A social queue item cannot move removed -> pending (content_manager)"
    );
  });

  it("refuses a content manager using a platform reason", () => {
    expect(() =>
      assertSocialQueueTransition(
        "pending",
        "removed",
        "content_manager",
        "consent_withdrawn"
      )
    ).toThrow(SocialQueueTransitionError);
  });
});

describe("canEditCaption", () => {
  it.each([
    ["pending", true],
    ["posted", false],
    ["removed", false],
  ] as const)("a %s item's caption is editable: %s", (status, editable) => {
    expect(canEditCaption(status)).toBe(editable);
  });
});
