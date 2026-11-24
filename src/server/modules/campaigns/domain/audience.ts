// Who a campaign reaches, and on whose consent (#126). The loader
// (../load-audience.ts) reads everyone a segment could hold and hands them
// here as candidates; this core decides, without a database:
//
//   - who matches the segment's definition (./segment.ts);
//   - who of those has current consent to be messaged. Only they are in the
//     segment: an adult's own consent to News and updates (`messages`), or
//     for a child, the guardian's consent to messages about the child
//     (`communications`). Never answered counts as no;
//   - who each message goes to. An adult gets their own. A child's goes to
//     the guardian who gave the child's consent, while they are still the
//     child's verified guardian, and never to the child, not even a teen
//     with an own login;
//   - one message per recipient. A guardian of two children in the segment,
//     who may also be in it themselves, gets one message that rests on
//     every consent involved.
//
// The same rule (`basisHolds`) is used when planning and again just before
// each message goes, so a withdrawal in between stops it.
//
// Pure: loads under plain Node, relative imports only.

import { matchesSegment, type SegmentAttributes } from "./segment";
import type { SegmentDefinition } from "./segment";

/** The latest consent event for one subject and purpose. */
export type ConsentStatus =
  | { status: "never" }
  | {
      status: "given" | "withdrawn";
      /** Who gave or withdrew it. For a child, a guardian. */
      giverUserId: string | null;
    };

/** One person the segment could include, with what decides it. */
export type AudienceCandidate =
  | {
      kind: "adult";
      userId: string;
      attributes: SegmentAttributes;
      /** Their own consent to News and updates. */
      messagesConsent: ConsentStatus;
    }
  | {
      kind: "child";
      /** The child's participant profile: the subject of their consents. */
      profileId: string;
      /** A teen's own login, if they have one. It never gets campaigns. */
      loginUserId: string | null;
      attributes: SegmentAttributes;
      /** The guardian's consent to messages about the child. */
      communicationsConsent: ConsentStatus;
      /** Users whose guardian link to the child is live and verified. */
      activeGuardianUserIds: readonly string[];
    };

/**
 * One consent a message rests on: the recipient's own (`messages`, about a
 * user) or a child's (`communications`, about a participant profile).
 */
export type ConsentBasis =
  | { purpose: "messages"; subjectId: string }
  | { purpose: "communications"; subjectId: string };

/** One message to one person, and every consent it rests on. */
export type PlannedRecipient = {
  userId: string;
  /** Own consent first, then each child's, by profile id. */
  bases: ConsentBasis[];
};

export type AudienceCounts = {
  /** People who match the definition, consent aside. */
  matched: number;
  /** Matched people with current consent whom a message reaches. */
  members: number;
  /** Distinct people messages go to (a guardian counts once). */
  recipients: number;
  /** Matched, but without current consent. */
  noConsent: number;
  /** A consented child whose consent giver no longer looks after them. */
  noGuardian: number;
};

export type AudiencePlan = {
  /** Sorted by user id. */
  recipients: PlannedRecipient[];
  counts: AudienceCounts;
};

/** What the rule needs to know about a basis now. */
export type BasisCheck =
  | { purpose: "messages"; current: ConsentStatus }
  | {
      purpose: "communications";
      current: ConsentStatus;
      /** The recipient's guardian link to the child is live and verified. */
      recipientIsActiveGuardian: boolean;
    };

/**
 * Whether a basis still lets a message go to `recipientUserId`: the consent
 * is given and, for a child, the recipient gave it and still looks after
 * the child.
 */
export function basisHolds(
  check: BasisCheck,
  recipientUserId: string
): boolean {
  if (check.current.status !== "given") return false;
  if (check.purpose === "messages") return true;
  return (
    check.recipientIsActiveGuardian &&
    check.current.giverUserId === recipientUserId
  );
}

function compareBases(a: ConsentBasis, b: ConsentBasis): number {
  if (a.purpose !== b.purpose) return a.purpose === "messages" ? -1 : 1;
  return a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0;
}

/** The recipients a campaign to `definition` has now, and its counts. */
export function planAudience(
  definition: SegmentDefinition,
  candidates: readonly AudienceCandidate[]
): AudiencePlan {
  const childLogins = new Set(
    candidates.flatMap((candidate) =>
      candidate.kind === "child" && candidate.loginUserId !== null
        ? [candidate.loginUserId]
        : []
    )
  );
  const byRecipient = new Map<string, ConsentBasis[]>();
  const deliver = (userId: string, basis: ConsentBasis) => {
    const bases = byRecipient.get(userId) ?? [];
    if (
      !bases.some(
        (each) =>
          each.purpose === basis.purpose && each.subjectId === basis.subjectId
      )
    ) {
      bases.push(basis);
    }
    byRecipient.set(userId, bases);
  };
  const counts: AudienceCounts = {
    matched: 0,
    members: 0,
    recipients: 0,
    noConsent: 0,
    noGuardian: 0,
  };

  for (const candidate of candidates) {
    if (!matchesSegment(definition, candidate.attributes)) continue;
    if (candidate.kind === "adult") {
      // A child's own login is the child: never an adult recipient.
      if (childLogins.has(candidate.userId)) continue;
      counts.matched += 1;
      if (
        !basisHolds(
          { purpose: "messages", current: candidate.messagesConsent },
          candidate.userId
        )
      ) {
        counts.noConsent += 1;
        continue;
      }
      counts.members += 1;
      deliver(candidate.userId, {
        purpose: "messages",
        subjectId: candidate.userId,
      });
      continue;
    }

    counts.matched += 1;
    const consent = candidate.communicationsConsent;
    if (consent.status !== "given") {
      counts.noConsent += 1;
      continue;
    }
    const guardian = consent.giverUserId;
    if (
      guardian === null ||
      childLogins.has(guardian) ||
      !basisHolds(
        {
          purpose: "communications",
          current: consent,
          recipientIsActiveGuardian:
            candidate.activeGuardianUserIds.includes(guardian),
        },
        guardian
      )
    ) {
      counts.noGuardian += 1;
      continue;
    }
    counts.members += 1;
    deliver(guardian, {
      purpose: "communications",
      subjectId: candidate.profileId,
    });
  }

  const recipients = [...byRecipient.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([userId, bases]) => ({
      userId,
      bases: bases.toSorted(compareBases),
    }));
  counts.recipients = recipients.length;
  return { recipients, counts };
}
