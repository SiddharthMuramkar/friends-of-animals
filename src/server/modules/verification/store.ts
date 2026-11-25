// Reading and writing FOA verification records (#92) inside a transaction.
// The use cases lock the school round (school route, F15) and the entry,
// read the latest record, ask the pure rules (./domain/decide.ts), and
// write the answer: a record, the entry's move (through the entries
// module), the audit row and the event.
//
// Loads under plain Node (the worker): relative imports only.

import { and, desc, eq } from "drizzle-orm";

import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import {
  entry,
  entryVerification,
  registration,
  schoolRound,
  type EntryVerificationRow,
} from "../../db/schema";
import { monotonicUuidv7 } from "../../ids";
import type { EntryStatus } from "../entries/domain/status";
import type { VerificationState } from "./domain/decide";

/** UUIDv7 identity for verification records. */
export const nextVerificationId = monotonicUuidv7();

/** The platform forwarding entries and returning resubmissions. */
export const WORKER: Actor = { kind: "system", process: "worker" };

/** The entry's newest verification record, if it has one. */
export async function latestVerification(
  db: AppDb,
  entryId: string
): Promise<EntryVerificationRow | null> {
  const [row] = await db
    .select()
    .from(entryVerification)
    .where(eq(entryVerification.entryId, entryId))
    .orderBy(desc(entryVerification.decidedAt), desc(entryVerification.id))
    .limit(1);
  return row ?? null;
}

/** What the rules need: the entry's status and its latest send-back. */
export function verificationStateOf(
  status: EntryStatus,
  latest: EntryVerificationRow | null
): VerificationState {
  const sentBack = latest?.decision === "sent_back" ? latest : null;
  return {
    status,
    resubmissionDueAt: sentBack?.resubmissionDueAt ?? null,
    resubmissionPending:
      status === "sent_back" &&
      sentBack?.resubmittedAt != null &&
      sentBack.resubmissionWithFile === true,
  };
}

/**
 * When a sent-back entry's resubmission window closes, for the entries
 * module's upload rules; null unless the entry is sent back.
 */
export async function resubmissionDueAt(
  db: AppDb,
  entryId: string,
  status: EntryStatus
): Promise<Date | null> {
  if (status !== "sent_back") return null;
  return (await latestVerification(db, entryId))?.resubmissionDueAt ?? null;
}

/** Where an entry came from: its registration and, on the school route, its institution registration. */
export type EntryRoute = {
  entryId: string;
  registrationId: string;
  competitionId: string;
  institutionRegistrationId: string | null;
};

export async function routeOfEntry(
  db: AppDb,
  where: { entryId: string } | { code: string }
): Promise<EntryRoute | null> {
  const [row] = await db
    .select({
      entryId: entry.id,
      registrationId: entry.registrationId,
      competitionId: entry.competitionId,
      institutionRegistrationId: registration.institutionRegistrationId,
    })
    .from(entry)
    .innerJoin(registration, eq(registration.id, entry.registrationId))
    .where(
      "entryId" in where
        ? eq(entry.id, where.entryId)
        : eq(entry.code, where.code)
    );
  return row ?? null;
}

/**
 * F15: a decision on a school-route entry locks its school round first, so
 * it waits for (and is waited on by) a reopening of that round (#90).
 */
export async function lockRoundOf(
  tx: AppDb,
  route: EntryRoute
): Promise<void> {
  if (!route.institutionRegistrationId) return;
  await tx
    .select({ id: schoolRound.id })
    .from(schoolRound)
    .where(
      eq(schoolRound.institutionRegistrationId, route.institutionRegistrationId)
    )
    .for("update");
}

/** Records the resubmission on the entry's open send-back. */
export async function recordResubmission(
  tx: AppDb,
  {
    verificationId,
    at,
    userId,
    withFile,
  }: {
    verificationId: string;
    at: Date;
    userId: string | null;
    withFile: boolean;
  }
): Promise<void> {
  await tx
    .update(entryVerification)
    .set({
      resubmittedAt: at,
      resubmittedByUserId: userId,
      resubmissionWithFile: withFile,
    })
    .where(
      and(
        eq(entryVerification.id, verificationId),
        eq(entryVerification.decision, "sent_back")
      )
    );
}
