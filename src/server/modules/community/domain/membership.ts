// Community membership: who may join, the status machine and the member
// profile. Pure: the use cases load the facts (the actor's guardian links,
// whether the child has an own login, the current membership) and pass
// them in. Loads under plain Node, so the schema can build its pgEnum here.
//
// Defaults until FOA rules otherwise (HR-57): anyone with a login joins for
// themselves, teens included; a guardian joins a linked child under 13 (a
// child with no login) on the child's behalf.

import { z } from "zod";

export const COMMUNITY_MEMBER_STATUSES = ["active", "left"] as const;

export type CommunityMemberStatus = (typeof COMMUNITY_MEMBER_STATUSES)[number];

type Transition = {
  /** `null` is a person who has never joined. */
  from: CommunityMemberStatus | null;
  to: CommunityMemberStatus;
};

/** Every allowed move. Anything not listed is forbidden. */
const MEMBERSHIP_TRANSITIONS: readonly Transition[] = [
  { from: null, to: "active" },
  { from: "active", to: "left" },
  // Joining again reactivates the same membership.
  { from: "left", to: "active" },
];

export function canTransitionMembership(
  from: CommunityMemberStatus | null,
  to: CommunityMemberStatus
): boolean {
  return MEMBERSHIP_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to
  );
}

/** Who the membership is for, as the use case found it. */
export type JoinTarget =
  | { target: "self" }
  | {
      target: "child";
      /** The actor holds an active guardian link to this child. */
      linkedGuardian: boolean;
      /** The child signs in with their own login (13 to 17). */
      childHasOwnLogin: boolean;
    };

export type JoinRefusal =
  | "not_guardian"
  | "child_joins_themselves"
  | "already_member";

/**
 * May this membership start (or start again)? `current` is the subject's
 * membership status, null when they never joined. On success, `from` is
 * the status the membership moves from to `active`.
 */
export function decideJoin(
  target: JoinTarget,
  current: CommunityMemberStatus | null
):
  | { ok: true; from: CommunityMemberStatus | null }
  | { ok: false; reason: JoinRefusal } {
  if (target.target === "child") {
    if (!target.linkedGuardian) return { ok: false, reason: "not_guardian" };
    if (target.childHasOwnLogin) {
      return { ok: false, reason: "child_joins_themselves" };
    }
  }
  if (!canTransitionMembership(current, "active")) {
    return { ok: false, reason: "already_member" };
  }
  return { ok: true, from: current };
}

/** May this membership end? Only an active one can. */
export function decideLeave(
  current: CommunityMemberStatus | null
): { ok: true } | { ok: false; reason: "not_member" } {
  return current !== null && canTransitionMembership(current, "left")
    ? { ok: true }
    : { ok: false, reason: "not_member" };
}

/** Characters, counting an emoji or other astral character once. */
const length = (text: string) => Array.from(text).length;

/** C0 control characters and DEL. */
const isControl = (char: string) => {
  const code = char.codePointAt(0)!;
  return code < 0x20 || code === 0x7f;
};

/** Whether `text` has a control character other than those in `allowed`. */
const hasControl = (text: string, allowed = "") =>
  Array.from(text).some((char) => isControl(char) && !allowed.includes(char));

export const DISPLAY_NAME_MAX = 60;
export const ABOUT_MAX = 280;

/**
 * The member profile as a form sends it: a display name of 2 to 60
 * characters on one line, and an optional "about" of up to 280. Blank
 * about becomes null. Nothing else is accepted.
 */
export const memberProfileSchema = z.strictObject({
  displayName: z
    .string()
    .trim()
    .refine((name) => length(name) >= 2, "too_short")
    .refine((name) => length(name) <= DISPLAY_NAME_MAX, "too_long")
    .refine((name) => !hasControl(name), "invalid_characters"),
  about: z
    .string()
    .trim()
    .refine((about) => length(about) <= ABOUT_MAX, "too_long")
    // The about may keep line breaks.
    .refine((about) => !hasControl(about, "\n"), "invalid_characters")
    .optional()
    .transform((about) => (about ? about : null)),
});

export type MemberProfile = z.output<typeof memberProfileSchema>;
