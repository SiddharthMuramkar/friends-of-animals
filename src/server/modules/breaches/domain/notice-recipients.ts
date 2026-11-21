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

/** A user account, or a child's profile that a guardian manages. */
export type AffectedRef = {
  type: "user" | "participant_profile";
  id: string;
};

export type AffectedPerson = {
  ref: AffectedRef;
  /** The account their own notice would go to, if they have one. */
  userId: string | null;
  /** Under 18 at the time of the notice. */
  minor: boolean;
  /** The user ids of their active guardians (empty for most adults). */
  guardianUserIds: readonly string[];
};

export type NoticeRecipient = {
  userId: string;
  /** Told about themselves, as a guardian, or both. */
  as: "principal" | "guardian" | "principal_and_guardian";
  /** The people this notice is about, in input order. */
  about: AffectedRef[];
};

export type UnreachablePerson = {
  ref: AffectedRef;
  reason: "no_guardian" | "no_account";
};

export type NoticePlan = {
  /** One per recipient, ordered by user id so plans compare stably. */
  recipients: NoticeRecipient[];
  unreachable: UnreachablePerson[];
};

const sameRef = (a: AffectedRef, b: AffectedRef) =>
  a.type === b.type && a.id === b.id;

/** Plans the notices for the people a breach touched. */
export function planBreachNotices(
  people: readonly AffectedPerson[]
): NoticePlan {
  const byUser = new Map<
    string,
    { principal: boolean; guardian: boolean; about: AffectedRef[] }
  >();
  const unreachable: UnreachablePerson[] = [];
  const seen: AffectedRef[] = [];

  const add = (
    userId: string,
    role: "principal" | "guardian",
    ref: AffectedRef
  ) => {
    const entry = byUser.get(userId) ?? {
      principal: false,
      guardian: false,
      about: [],
    };
    entry[role] = true;
    if (!entry.about.some((known) => sameRef(known, ref)))
      entry.about.push(ref);
    byUser.set(userId, entry);
  };

  for (const person of people) {
    if (seen.some((ref) => sameRef(ref, person.ref))) continue;
    seen.push(person.ref);
    if (person.minor) {
      const guardians = [...new Set(person.guardianUserIds)];
      if (guardians.length === 0) {
        unreachable.push({ ref: person.ref, reason: "no_guardian" });
      }
      for (const guardian of guardians) add(guardian, "guardian", person.ref);
    } else if (person.userId === null) {
      unreachable.push({ ref: person.ref, reason: "no_account" });
    } else {
      add(person.userId, "principal", person.ref);
    }
  }

  const recipients = [...byUser.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([userId, entry]) => ({
      userId,
      as:
        entry.principal && entry.guardian
          ? ("principal_and_guardian" as const)
          : entry.principal
            ? ("principal" as const)
            : ("guardian" as const),
      about: entry.about,
    }));
  return { recipients, unreachable };
}
