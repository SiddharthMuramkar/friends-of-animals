// Who a campaign reaches, and on whose consent. The audience loader reads
// the people a segment could include and hands them here as candidates.
// This core then decides, without a database:
//
//   - who matches the segment's definition;
//   - who of those has current communication consent. Only they are in the
//     segment;
//   - who each message goes to. An adult gets their own message. A minor's
//     message goes to the guardian who gave the child's consent, and never
//     to the child, even a teen with their own login;
//   - one delivery per recipient. A guardian of two children in the segment,
//     who may also be in it themselves, gets one message that lists every
//     consent it rests on.
//
// The same rule (`basisHolds`) is used when planning and again just before
// each message is sent, so a withdrawal in between stops the message.
//
// Pure: loads under plain Node, relative imports only.

import type {
  CampaignStatus,
  DeliverySkipReasonCode,
} from "./campaign-lifecycle";
import {
  matchesSegment,
  type SegmentAttributes,
  type SegmentDefinition,
} from "./segment-definition";

/**
 * The latest consent event for one subject and purpose, as the loader read
 * it. Only `given` lets a message go.
 */
export type ConsentStatus =
  | { status: "never" }
  | {
      status: "given" | "withdrawn";
      /** The latest event's id. */
      eventId: string;
      /** Who gave or withdrew it. For a child, a guardian. */
      giverUserId: string;
    };

/** One person the segment could include, with what decides it. */
export type AudienceCandidate =
  | {
      kind: "adult";
      userId: string;
      attributes: SegmentAttributes;
      /** Their own consent to news and updates (`messages`). */
      messagesConsent: ConsentStatus;
    }
  | {
      kind: "minor";
      /** The child's participant profile: the subject of their consents. */
      profileId: string;
      /** A teen's own login, if they have one. It never gets campaigns. */
      loginUserId: string | null;
      attributes: SegmentAttributes;
      /** The child's `communications` consent, given by a guardian. */
      communicationsConsent: ConsentStatus;
      /** Users whose guardian link to the child is active and verified. */
      activeGuardianUserIds: readonly string[];
    };

/** One consent a delivery rests on, and who the message is about. */
export type ConsentBasis =
  | { purpose: "messages"; eventId: string; aboutUserId: string }
  | { purpose: "communications"; eventId: string; aboutProfileId: string };

/** One message to one person, and every consent it rests on. */
export type PlannedDelivery = {
  recipientUserId: string;
  /** Own consent first, then each child's, by profile id. */
  bases: ConsentBasis[];
};

export type AudienceCounts = {
  /** People who match the definition, consent aside. */
  matched: number;
  /** Matched people with current consent whom a message reaches. */
  members: number;
  /** Distinct people messages go to (guardians count once). */
  recipients: number;
  skipped: {
    /** Matched, but without current consent. */
    noConsent: number;
    /** A consented child whose consent giver is no longer their guardian. */
    noGuardian: number;
  };
};

export type AudiencePlan = {
  /** Sorted by recipient id. */
  deliveries: PlannedDelivery[];
  counts: AudienceCounts;
};

/** The loader listed one person twice: a bug, so nothing is planned. */
export class AudienceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudienceInputError";
  }
}

/** What the rule needs to know about a basis right now. */
export type BasisCheck =
  | { purpose: "messages"; current: ConsentStatus }
  | {
      purpose: "communications";
      current: ConsentStatus;
      /** Whether the recipient's guardian link to the child is active. */
      recipientIsActiveGuardian: boolean;
    };

/**
 * Whether a basis still lets a message go to `recipientUserId`: the consent
 * is given and, for a child, it was given by the recipient while they are
 * an active guardian. A consent re-given on a newer document still counts.
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

function personKeys(candidate: AudienceCandidate): string[] {
  if (candidate.kind === "adult") return [`user:${candidate.userId}`];
  return [
    `profile:${candidate.profileId}`,
    ...(candidate.loginUserId === null
      ? []
      : [`user:${candidate.loginUserId}`]),
  ];
}

function assertEachPersonOnce(candidates: readonly AudienceCandidate[]) {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    for (const key of personKeys(candidate)) {
      if (seen.has(key)) {
        throw new AudienceInputError(
          `The audience lists ${key} more than once`
        );
      }
      seen.add(key);
    }
  }
}

function compareBases(a: ConsentBasis, b: ConsentBasis): number {
  if (a.purpose !== b.purpose) return a.purpose === "messages" ? -1 : 1;
  const left = a.purpose === "messages" ? a.aboutUserId : a.aboutProfileId;
  const right = b.purpose === "messages" ? b.aboutUserId : b.aboutProfileId;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The deliveries a campaign to `definition` makes, and the counts staff
 * see before sending. Throws `AudienceInputError` if a person appears
 * twice (an adult and a teen's login are one person if they share an id).
 */
export function planAudience(
  definition: SegmentDefinition,
  candidates: readonly AudienceCandidate[]
): AudiencePlan {
  assertEachPersonOnce(candidates);
  const minorLogins = new Set(
    candidates.flatMap((candidate) =>
      candidate.kind === "minor" && candidate.loginUserId !== null
        ? [candidate.loginUserId]
        : []
    )
  );

  const byRecipient = new Map<string, ConsentBasis[]>();
  const deliver = (recipientUserId: string, basis: ConsentBasis) => {
    const bases = byRecipient.get(recipientUserId) ?? [];
    bases.push(basis);
    byRecipient.set(recipientUserId, bases);
  };

  const counts: AudienceCounts = {
    matched: 0,
    members: 0,
    recipients: 0,
    skipped: { noConsent: 0, noGuardian: 0 },
  };

  for (const candidate of candidates) {
    if (!matchesSegment(definition, candidate.attributes)) continue;
    counts.matched += 1;

    if (candidate.kind === "adult") {
      const consent = candidate.messagesConsent;
      if (consent.status !== "given") {
        counts.skipped.noConsent += 1;
        continue;
      }
      counts.members += 1;
      deliver(candidate.userId, {
        purpose: "messages",
        eventId: consent.eventId,
        aboutUserId: candidate.userId,
      });
      continue;
    }

    const consent = candidate.communicationsConsent;
    if (consent.status !== "given") {
      counts.skipped.noConsent += 1;
      continue;
    }
    const guardian = consent.giverUserId;
    const reachable =
      !minorLogins.has(guardian) &&
      basisHolds(
        {
          purpose: "communications",
          current: consent,
          recipientIsActiveGuardian:
            candidate.activeGuardianUserIds.includes(guardian),
        },
        guardian
      );
    if (!reachable) {
      counts.skipped.noGuardian += 1;
      continue;
    }
    counts.members += 1;
    deliver(guardian, {
      purpose: "communications",
      eventId: consent.eventId,
      aboutProfileId: candidate.profileId,
    });
  }

  const deliveries = [...byRecipient.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([recipientUserId, bases]) => ({
      recipientUserId,
      bases: bases.toSorted(compareBases),
    }));
  counts.recipients = deliveries.length;
  return { deliveries, counts };
}

export type DeliveryDecision =
  | {
      action: "send";
      /** Indexes into the checks given, of the bases that still hold. */
      holding: number[];
    }
  | { action: "skip"; reason: DeliverySkipReasonCode };

/**
 * The check just before one queued message is sent: only while the
 * campaign is sending, and only if at least one of its bases still holds.
 * Messages are queued only while sending, so any other status means the
 * campaign was cancelled.
 */
export function decideDelivery(input: {
  campaignStatus: CampaignStatus;
  recipientUserId: string;
  bases: readonly BasisCheck[];
}): DeliveryDecision {
  if (input.campaignStatus !== "sending") {
    return { action: "skip", reason: "cancelled" };
  }
  const holding = input.bases.flatMap((check, index) =>
    basisHolds(check, input.recipientUserId) ? [index] : []
  );
  return holding.length === 0
    ? { action: "skip", reason: "consent_withdrawn" }
    : { action: "send", holding };
}
