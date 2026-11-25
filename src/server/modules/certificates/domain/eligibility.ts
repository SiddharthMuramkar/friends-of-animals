// Who earns which certificate when a competition's results are published.
// Pure: the issuing use case loads these facts, calls `planCertificates`
// for the full expected set, and inserts only what `missingCertificates`
// says is not there yet, so running it again issues nothing twice.
//
// The rules, until FOA decides otherwise (defaults recorded as residue):
// - Only confirmed registrations earn anything. Withdrawn and disqualified
//   ones earn nothing, awards included.
// - Participation goes to everyone who took part: an entry that reached
//   `submitted` (individual route, and school students in competitions
//   where everyone submits), or, in shortlist-only competitions, every
//   student of a school round the school has decided, since the school
//   judged their work in person. Any award also counts as taking part.
// - School merit goes to each student holding a school position in a
//   decided school round.
// - Winner, runner-up and finalist come from the published final round.
//   A registration gets only its best award; a special mention earns no
//   certificate of its own.

import type { CertificateType } from "./status";

export type CompetitionFacts = {
  /** Whether every student submits online, or only the school shortlist. */
  submissionScope: "all_participants" | "shortlist_only";
  /** The round the published results come from. */
  finalRoundId: string | null;
};

export type RegistrationFacts = {
  registrationId: string;
  participantProfileId: string;
  route: "individual" | "institution";
  standing: "confirmed" | "withdrawn" | "disqualified" | "not_confirmed";
  /** Whether any of the registration's entries ever reached `submitted`. */
  entryReachedSubmitted: boolean;
  /** Institution route: the student's school round, if it has one. */
  schoolRound: {
    roundId: string;
    /** Finalised by the school, or closed on its behalf. */
    decided: boolean;
    /** The positioned entry, when there is one. */
    entryId: string | null;
    /** The school position, 1 being first; `null` without one. */
    position: number | null;
  } | null;
};

/** A line of the published final round for one entry. */
export type FinalOutcome = {
  registrationId: string;
  entryId: string;
  outcome: "winner" | "runner_up" | "finalist" | "special_mention" | "none";
  awardPosition: number | null;
};

/** A certificate results publishing issues. */
export type ExpectedCertificate = {
  registrationId: string;
  participantProfileId: string;
  type: Exclude<CertificateType, "volunteer_service">;
  /** The school or final round it was earned in; `null` for participation. */
  roundId: string | null;
  entryId: string | null;
  awardPosition: number | null;
};

/** What makes two certificates the same one, whatever their status. */
export type CertificateIdentity = Pick<
  ExpectedCertificate,
  "registrationId" | "type" | "roundId"
>;

type Award = "winner" | "runner_up" | "finalist";

/** Awards from best to worst; outcomes not listed earn no certificate. */
const AWARD_RANK: readonly Award[] = ["winner", "runner_up", "finalist"];

function isAward(outcome: FinalOutcome["outcome"]): outcome is Award {
  return AWARD_RANK.some((award) => award === outcome);
}

/** Each registration's best award in the final round. */
function bestAwards(
  outcomes: readonly FinalOutcome[]
): Map<string, FinalOutcome & { outcome: Award }> {
  const best = new Map<string, FinalOutcome & { outcome: Award }>();
  for (const line of outcomes) {
    const { outcome } = line;
    if (!isAward(outcome)) continue;
    const current = best.get(line.registrationId);
    if (
      !current ||
      AWARD_RANK.indexOf(outcome) < AWARD_RANK.indexOf(current.outcome)
    ) {
      best.set(line.registrationId, { ...line, outcome });
    }
  }
  return best;
}

function tookPartWithoutAward(
  competition: CompetitionFacts,
  registration: RegistrationFacts
): boolean {
  if (
    registration.route === "institution" &&
    competition.submissionScope === "shortlist_only"
  ) {
    return registration.schoolRound?.decided === true;
  }
  return registration.entryReachedSubmitted;
}

/**
 * Every certificate the published results earn, in a stable order: by
 * registration as given, then participation, school merit, final award.
 *
 * Throws a RangeError when the facts contradict each other (a registration
 * listed twice, an award for a registration not listed, awards without a
 * final round): the loader has a bug, and issuing half a set would hide it.
 */
export function planCertificates(
  competition: CompetitionFacts,
  registrations: readonly RegistrationFacts[],
  outcomes: readonly FinalOutcome[]
): ExpectedCertificate[] {
  const known = new Set<string>();
  for (const { registrationId } of registrations) {
    if (known.has(registrationId)) {
      throw new RangeError(`Registration ${registrationId} is listed twice`);
    }
    known.add(registrationId);
  }
  for (const { registrationId } of outcomes) {
    if (!known.has(registrationId)) {
      throw new RangeError(
        `The final round has an outcome for registration ${registrationId}, which was not loaded`
      );
    }
  }
  const awards = bestAwards(outcomes);
  if (awards.size > 0 && competition.finalRoundId === null) {
    throw new RangeError("Final-round awards need the final round's id");
  }

  const plan: ExpectedCertificate[] = [];
  for (const registration of registrations) {
    if (registration.standing !== "confirmed") continue;
    const { registrationId, participantProfileId, schoolRound } = registration;
    const earned: ExpectedCertificate[] = [];

    if (schoolRound?.decided && schoolRound.position !== null) {
      earned.push({
        registrationId,
        participantProfileId,
        type: "school_merit",
        roundId: schoolRound.roundId,
        entryId: schoolRound.entryId,
        awardPosition: schoolRound.position,
      });
    }
    const award = awards.get(registrationId);
    if (award) {
      earned.push({
        registrationId,
        participantProfileId,
        type: award.outcome,
        roundId: competition.finalRoundId,
        entryId: award.entryId,
        awardPosition: award.awardPosition,
      });
    }

    if (earned.length > 0 || tookPartWithoutAward(competition, registration)) {
      plan.push({
        registrationId,
        participantProfileId,
        type: "participation",
        roundId: null,
        entryId: null,
        awardPosition: null,
      });
    }
    plan.push(...earned);
  }
  return plan;
}

function identityKey({
  registrationId,
  type,
  roundId,
}: CertificateIdentity): string {
  return JSON.stringify([registrationId, type, roundId]);
}

/**
 * The planned certificates not issued yet. `issued` should hold every
 * existing certificate of the competition whatever its status, so a
 * revoked or replaced certificate is never issued again by a re-run.
 */
export function missingCertificates(
  plan: readonly ExpectedCertificate[],
  issued: readonly CertificateIdentity[]
): ExpectedCertificate[] {
  const existing = new Set(issued.map(identityKey));
  return plan.filter((certificate) => !existing.has(identityKey(certificate)));
}
