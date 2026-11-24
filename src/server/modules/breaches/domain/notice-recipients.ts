// Who gets a breach notice (#116). Each person a breach touched is told,
// as the law requires (a `required_by_law` route, so preferences don't stop
// it). An adult is told directly. A child (under 18) is never told
// directly: their active guardians are, whether the child has their own
// teen login or is a profile a guardian manages. A child with no active
// guardian can't be reached, and the plan says so, so staff see the gap.
//
// One person gets one notice, however many of the people it is about they
// answer for: a parent of two affected children, or an affected adult who
// is also an affected child's guardian, is listed once with everyone it
// concerns. The delivery row is unique per (breach, recipient, channel),
// so a replay sends nothing new.
//
// Pure, and loads under plain Node. The use case loads ages (decrypting
// the date of birth, never in SQL) and guardians (81a) into this shape.

/** What an affected person is on the platform: an account or a profile. */
export const AFFECTED_REF_TYPES = ["user", "participant_profile"] as const;

/** A user account, or a child's profile that a guardian manages. */
export type AffectedRef = {
  type: (typeof AFFECTED_REF_TYPES)[number];
  id: string;
};

/** How a recipient is told: about themselves, as a guardian, or both. */
export const NOTICE_RECIPIENT_ROLES = [
  "principal",
  "guardian",
  "principal_and_guardian",
] as const;

export type NoticeRecipientRole = (typeof NOTICE_RECIPIENT_ROLES)[number];

/**
 * The most people one plan covers: a list staff give at once, or one page
 * of the fan-out to every account, which runs in the worker.
 */
export const BREACH_FAN_OUT_PAGE_SIZE = 500;

/** Why a notice can't reach someone a breach touched. */
export const UNREACHABLE_REASONS = ["no_guardian", "no_account"] as const;

export type AffectedPerson = {
  ref: AffectedRef;
  /** The account their own notice would go to, if they have one. */
  userId: string | null;
  /** Under 18 at the time of the notice. */
  minor: boolean;
  /** Verified guardians, with the profile on which each link was found. */
  guardians: readonly { userId: string; profileId: string }[];
};

export type NoticeRecipient = {
  userId: string;
  /** Told about themselves, as a guardian, or both. */
  as: NoticeRecipientRole;
  /** The people this notice is about, in input order. */
  about: AffectedRef[];
  /** The child profiles to recheck before sending on a pending channel. */
  guardianProfileIds: string[];
};

export type UnreachablePerson = {
  ref: AffectedRef;
  reason: (typeof UNREACHABLE_REASONS)[number];
};

export type NoticePlan = {
  /** One per recipient, ordered by user id so plans compare stably. */
  recipients: NoticeRecipient[];
  unreachable: UnreachablePerson[];
};

/** Plans the notices for the people a breach touched. */
export function planBreachNotices(
  people: readonly AffectedPerson[]
): NoticePlan {
  const byUser = new Map<
    string,
    { principal: boolean; about: AffectedRef[]; guardianProfiles: Set<string> }
  >();
  const unreachable: UnreachablePerson[] = [];

  // A participant profile and its login or own account can name one person.
  const subjects = new Map<string, AffectedPerson>();
  for (const person of people) {
    const key = person.userId
      ? `user:${person.userId}`
      : `${person.ref.type}:${person.ref.id}`;
    const existing = subjects.get(key);
    subjects.set(
      key,
      existing
        ? {
            ...existing,
            minor: existing.minor || person.minor,
            guardians: [...existing.guardians, ...person.guardians],
          }
        : person
    );
  }

  const add = (
    userId: string,
    ref: AffectedRef,
    profiles: readonly string[]
  ) => {
    const entry = byUser.get(userId) ?? {
      principal: false,
      about: [],
      guardianProfiles: new Set<string>(),
    };
    if (profiles.length === 0) entry.principal = true;
    for (const profileId of profiles) entry.guardianProfiles.add(profileId);
    entry.about.push(ref);
    byUser.set(userId, entry);
  };

  for (const person of subjects.values()) {
    if (person.minor) {
      const byGuardian = Map.groupBy(person.guardians, (link) => link.userId);
      if (byGuardian.size === 0) {
        unreachable.push({ ref: person.ref, reason: "no_guardian" });
      }
      for (const [guardianId, links] of byGuardian) {
        add(
          guardianId,
          person.ref,
          links.map((link) => link.profileId)
        );
      }
    } else if (person.userId === null) {
      unreachable.push({ ref: person.ref, reason: "no_account" });
    } else {
      add(person.userId, person.ref, []);
    }
  }

  const recipients = [...byUser.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([userId, entry]) => ({
      userId,
      as:
        entry.principal && entry.guardianProfiles.size > 0
          ? ("principal_and_guardian" as const)
          : entry.principal
            ? ("principal" as const)
            : ("guardian" as const),
      about: entry.about,
      guardianProfileIds: [...entry.guardianProfiles],
    }));
  return { recipients, unreachable };
}
