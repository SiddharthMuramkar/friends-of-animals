// Telling families the school round's outcome (#89), in two outbox steps
// after school_round.shortlist_finalised:
//
// 1. school_round.queue_family_outcomes: one entry.school_shortlisted or
//    entry.not_shortlisted event per entry of the round, queued once per
//    finalising (the round's `families_notified_at`), so a rerun of the
//    handler queues nothing twice. One event per entry also keeps two
//    siblings with the same guardian from sharing one delivery claim.
// 2. school_round.send_family_outcome: emails the student's family contact
//    (a minor's guardian, or the adult student, kept on the participant
//    profile, not a user) with the template of that event's `family_contact`
//    route, as the entry receipt does (entries/family-receipt.ts). A minor
//    is never told directly. Email only: SMS waits for registered DLT
//    templates (HR-14). The wording waits for FOA (HR-36).
//
// Closing a round on the school's behalf (#90) reuses both.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  competition,
  entry,
  institution,
  institutionRegistration,
  participantProfile,
  schoolRound,
  schoolRoundPick,
} from "../../db/schema";
import { emitBatch } from "../../outbox/emit";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import type { Clock } from "../../ports/clock";
import {
  confirmationValues,
  familyContactEmail,
} from "../registration/confirmation-message";
import { loadPicks, loadRoundEntries, loadRoundStudents } from "./store";

/** The variables the two outcome templates may use, beyond the recipient's. */
export const SCHOOL_ROUND_OUTCOME_VARIABLES = [
  "participant.name",
  "institution.name",
  "competition.name",
  "entry.code",
  "entry.positionNote",
] as const;

/** Queues each entry's outcome message, once per finalising. */
export async function queueFamilyOutcomes(
  deps: { db: AppDb; clock: Clock },
  { roundId }: { roundId: string }
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [round] = await tx
      .select()
      .from(schoolRound)
      .where(eq(schoolRound.id, roundId))
      .for("update");
    if (!round || round.status !== "finalised" || round.familiesNotifiedAt) {
      return;
    }
    const entries = await loadRoundEntries(tx, round.institutionRegistrationId);
    const picked = new Set(
      (await loadPicks(tx, round.id)).map((pick) => pick.entryId)
    );
    await emitBatch(
      tx,
      deps.clock,
      entries.map(({ entryId, registrationId }) => ({
        type: picked.has(entryId)
          ? ("entry.school_shortlisted" as const)
          : ("entry.not_shortlisted" as const),
        aggregate: { type: "entry" as const, id: entryId },
        payload: { entryId, registrationId, roundId },
      }))
    );
    const [scope] = await tx
      .select({ digitalScope: competition.digitalScope })
      .from(competition)
      .where(eq(competition.id, round.competitionId));
    if (scope?.digitalScope === "shortlist_only") {
      const students = await loadRoundStudents(
        tx,
        round.institutionRegistrationId
      );
      await emitBatch(
        tx,
        deps.clock,
        students
          .filter((student) => !student.entry)
          .map(({ registrationId }) => ({
            type: "registration.not_shortlisted" as const,
            aggregate: { type: "registration" as const, id: registrationId },
            payload: { registrationId, roundId },
          }))
      );
    }
    await tx
      .update(schoolRound)
      .set({ familiesNotifiedAt: deps.clock.now() })
      .where(eq(schoolRound.id, roundId));
  });
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** The outcome templates' values for one entry of a round. */
export async function outcomeValues(
  db: AppDb,
  { entryId, roundId }: { entryId: string; roundId: string }
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      code: entry.code,
      participantName: participantProfile.fullName,
      competitionName: competition.name,
      institutionName: institution.name,
      position: schoolRoundPick.position,
    })
    .from(entry)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, entry.participantProfileId)
    )
    .innerJoin(competition, eq(competition.id, entry.competitionId))
    .innerJoin(schoolRound, eq(schoolRound.id, roundId))
    .innerJoin(
      institutionRegistration,
      eq(institutionRegistration.id, schoolRound.institutionRegistrationId)
    )
    .innerJoin(
      institution,
      eq(institution.id, institutionRegistration.institutionId)
    )
    .leftJoin(
      schoolRoundPick,
      and(
        eq(schoolRoundPick.entryId, entry.id),
        eq(schoolRoundPick.roundId, roundId)
      )
    )
    .where(eq(entry.id, entryId));
  if (!row) return {};
  return {
    "participant.name": row.participantName,
    "institution.name": row.institutionName,
    "competition.name": row.competitionName,
    "entry.code": row.code,
    "entry.positionNote":
      row.position === null
        ? ""
        : `The school also placed it ${ordinal(row.position)} in its category.`,
  };
}

/** Emails one entry's family its school round outcome. */
export async function sendFamilyOutcome(
  deps: OutboxDeps,
  delivery: Delivery<
    | "entry.school_shortlisted"
    | "entry.not_shortlisted"
    | "registration.not_shortlisted"
  >
): Promise<void> {
  const { registrationId } = delivery.payload;
  const message = await familyContactEmail(deps, {
    eventType: delivery.eventType,
    registrationId,
    // A refund (#80) or a cancellation since: nothing to send.
    sendWhile: (status) => status === "confirmed",
    values: () =>
      "entryId" in delivery.payload
        ? outcomeValues(deps.db, delivery.payload)
        : confirmationValues(deps.db, registrationId),
  });
  if (message) await deps.email.send(message, { deliveryId: delivery.id });
}
