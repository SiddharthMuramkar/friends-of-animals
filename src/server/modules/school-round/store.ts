// Reading and writing school rounds (#89): the round of an institution
// registration, its entries with the category each is judged in, its
// panel and picks, and its status changes. Shared by the use cases and the
// worker's handlers.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq } from "drizzle-orm";

import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import {
  competitionAgeGroup,
  competitionCategory,
  entry,
  participantProfile,
  registration,
  schoolRound,
  schoolRoundPanelMember,
  schoolRoundPick,
  schoolRoundTransition,
  type SchoolRoundRow,
} from "../../db/schema";
import { monotonicUuidv7 } from "../../ids";
import type { Clock } from "../../ports/clock";
import type { Discipline } from "../competitions/domain/vocabulary";
import type { EntryStatus } from "../entries/domain/status";
import type { Pick } from "./domain/picks";
import {
  assertSchoolRoundTransition,
  type SchoolRoundStatus,
} from "./domain/status";

/** UUIDv7 identity for rounds and their rows. */
export const nextRoundRowId = monotonicUuidv7();

/** The round of an institution registration, locked if asked. */
export async function loadRound(
  db: AppDb,
  institutionRegistrationId: string,
  { lock = false }: { lock?: boolean } = {}
): Promise<SchoolRoundRow | null> {
  const query = db
    .select()
    .from(schoolRound)
    .where(
      eq(schoolRound.institutionRegistrationId, institutionRegistrationId)
    );
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

/** One entry of a round's students, as the round sees it. */
export type RoundEntry = {
  entryId: string;
  code: string;
  title: string;
  registrationId: string;
  studentName: string;
  status: EntryStatus;
  discipline: Discipline;
  /** The competition category it is judged in; null if none matches. */
  categoryId: string | null;
  ageGroupLabel: string | null;
};

/**
 * Every entry of the institution registration's students, in any status,
 * in the order the students' entries were made. With `lock`, the entries
 * are locked until the transaction ends.
 */
export async function loadRoundEntries(
  db: AppDb,
  institutionRegistrationId: string,
  { lock = false }: { lock?: boolean } = {}
): Promise<RoundEntry[]> {
  const query = db
    .select({
      entryId: entry.id,
      code: entry.code,
      title: entry.title,
      registrationId: entry.registrationId,
      studentName: participantProfile.fullName,
      status: entry.status,
      discipline: entry.discipline,
      categoryId: competitionCategory.id,
      ageGroupLabel: competitionAgeGroup.label,
    })
    .from(entry)
    .innerJoin(registration, eq(registration.id, entry.registrationId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, entry.participantProfileId)
    )
    .leftJoin(
      competitionAgeGroup,
      eq(competitionAgeGroup.id, registration.ageGroupId)
    )
    .leftJoin(
      competitionCategory,
      and(
        eq(competitionCategory.competitionId, entry.competitionId),
        eq(competitionCategory.discipline, entry.discipline),
        eq(competitionCategory.ageGroupId, registration.ageGroupId)
      )
    )
    .where(
      and(
        eq(registration.institutionRegistrationId, institutionRegistrationId),
        eq(registration.route, "institution")
      )
    )
    .orderBy(asc(entry.createdAt), asc(entry.id));
  return lock ? query.for("update", { of: entry }) : query;
}

export type PanelMember = { fullName: string; designation: string };

export async function loadPanel(
  db: AppDb,
  roundId: string
): Promise<PanelMember[]> {
  return db
    .select({
      fullName: schoolRoundPanelMember.fullName,
      designation: schoolRoundPanelMember.designation,
    })
    .from(schoolRoundPanelMember)
    .where(eq(schoolRoundPanelMember.roundId, roundId))
    .orderBy(asc(schoolRoundPanelMember.sortOrder));
}

export type StoredPick = Pick & { categoryId: string };

export async function loadPicks(
  db: AppDb,
  roundId: string
): Promise<StoredPick[]> {
  return db
    .select({
      entryId: schoolRoundPick.entryId,
      position: schoolRoundPick.position,
      categoryId: schoolRoundPick.categoryId,
    })
    .from(schoolRoundPick)
    .where(eq(schoolRoundPick.roundId, roundId))
    .orderBy(
      asc(schoolRoundPick.categoryId),
      asc(schoolRoundPick.position),
      asc(schoolRoundPick.entryId)
    );
}

/** Records a round's status change, after the machine allows it. */
export async function recordRoundTransition(
  tx: AppDb,
  ctx: { clock: Clock; actor: Actor },
  move: {
    roundId: string;
    from: SchoolRoundStatus | null;
    to: SchoolRoundStatus;
    reason?: string;
  }
): Promise<void> {
  assertSchoolRoundTransition(move.from, move.to);
  const now = ctx.clock.now();
  await tx.insert(schoolRoundTransition).values({
    id: nextRoundRowId(now),
    roundId: move.roundId,
    fromStatus: move.from,
    toStatus: move.to,
    actorKind: ctx.actor.kind === "user" ? "user" : "system",
    actorUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
    reason: move.reason ?? null,
    at: now,
  });
}
