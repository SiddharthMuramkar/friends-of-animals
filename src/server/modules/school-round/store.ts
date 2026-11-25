// Reading and writing school rounds (#89): the round of an institution
// registration, its entries with the category each is judged in, its
// panel and picks, and its status changes. Shared by the use cases and the
// worker's handlers.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq, exists, inArray } from "drizzle-orm";

import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import {
  competitionAgeGroup,
  competitionCategory,
  entry,
  entryFile,
  institutionRegistration,
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
import type { EntryFileStatus, EntryStatus } from "../entries/domain/status";
import type { Pick } from "./domain/picks";
import {
  assertSchoolRoundTransition,
  type SchoolRoundStatus,
} from "./domain/status";

/**
 * The competition's institution registrations that get a school round:
 * active ones with at least one confirmed student, with their round's
 * status (null while it hasn't opened).
 */
export async function confirmedRegistrations(
  db: AppDb,
  competitionId: string
): Promise<{ id: string; roundStatus: SchoolRoundStatus | null }[]> {
  return db
    .select({ id: institutionRegistration.id, roundStatus: schoolRound.status })
    .from(institutionRegistration)
    .leftJoin(
      schoolRound,
      eq(schoolRound.institutionRegistrationId, institutionRegistration.id)
    )
    .where(
      and(
        eq(institutionRegistration.competitionId, competitionId),
        eq(institutionRegistration.status, "active"),
        exists(
          db
            .select({ id: registration.id })
            .from(registration)
            .where(
              and(
                eq(
                  registration.institutionRegistrationId,
                  institutionRegistration.id
                ),
                eq(registration.status, "confirmed")
              )
            )
        )
      )
    )
    .orderBy(institutionRegistration.id);
}

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
 * by student name. With `lock`, the entries
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
    .orderBy(asc(participantProfile.fullName), asc(entry.code));
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

/** What a shortlisted entry's latest upload shows (#91). */
export type UploadState = "checking" | "live" | "rejected" | "failed";

/** A confirmed student of a shortlist-only round, with their entry (#91). */
export type RoundStudent = {
  registrationId: string;
  registrationNumber: string | null;
  name: string;
  ageGroupLabel: string | null;
  disciplines: Discipline[];
  entry: {
    entryId: string;
    code: string;
    title: string;
    description: string;
    statement: string | null;
    discipline: Discipline;
    status: EntryStatus;
    /** The latest upload's state; null if it has none. */
    upload: UploadState | null;
    /** One of its uploads is live: it can go on to FOA. */
    hasLiveFile: boolean;
    /** Its school position, if its pick has one. */
    position: number | null;
  } | null;
};

const UPLOAD_STATE: Record<EntryFileStatus, UploadState | null> = {
  pending: "checking",
  processing: "checking",
  live: "live",
  rejected: "rejected",
  failed: "failed",
  superseded: null,
};

/** Every confirmed student of the institution registration, by name. */
export async function loadRoundStudents(
  db: AppDb,
  institutionRegistrationId: string
): Promise<RoundStudent[]> {
  const students = await db
    .select({
      registrationId: registration.id,
      registrationNumber: registration.registrationNumber,
      name: participantProfile.fullName,
      ageGroupLabel: competitionAgeGroup.label,
      ageGroupId: registration.ageGroupId,
      competitionId: registration.competitionId,
      entryId: entry.id,
      code: entry.code,
      title: entry.title,
      description: entry.description,
      statement: entry.statement,
      discipline: entry.discipline,
      status: entry.status,
      position: schoolRoundPick.position,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .leftJoin(
      competitionAgeGroup,
      eq(competitionAgeGroup.id, registration.ageGroupId)
    )
    .leftJoin(entry, eq(entry.registrationId, registration.id))
    .leftJoin(schoolRoundPick, eq(schoolRoundPick.entryId, entry.id))
    .where(
      and(
        eq(registration.institutionRegistrationId, institutionRegistrationId),
        eq(registration.route, "institution"),
        eq(registration.status, "confirmed")
      )
    )
    .orderBy(asc(participantProfile.fullName), asc(registration.id));
  const entryIds = students.flatMap((row) =>
    row.entryId ? [row.entryId] : []
  );
  const files =
    entryIds.length === 0
      ? []
      : await db
          .select({ entryId: entryFile.entryId, status: entryFile.status })
          .from(entryFile)
          .where(inArray(entryFile.entryId, entryIds))
          .orderBy(asc(entryFile.attemptNumber));
  const categories = students[0]
    ? await db
        .select({
          ageGroupId: competitionCategory.ageGroupId,
          discipline: competitionCategory.discipline,
        })
        .from(competitionCategory)
        .where(eq(competitionCategory.competitionId, students[0].competitionId))
    : [];
  return students.map((row) => {
    const own = files.filter((file) => file.entryId === row.entryId);
    const latest = own.at(-1);
    return {
      registrationId: row.registrationId,
      registrationNumber: row.registrationNumber,
      name: row.name,
      ageGroupLabel: row.ageGroupLabel,
      disciplines: categories
        .filter((category) => category.ageGroupId === row.ageGroupId)
        .map((category) => category.discipline),
      entry:
        row.entryId && row.code && row.title && row.discipline && row.status
          ? {
              entryId: row.entryId,
              code: row.code,
              title: row.title,
              description: row.description ?? "",
              statement: row.statement,
              discipline: row.discipline,
              status: row.status,
              upload: latest ? UPLOAD_STATE[latest.status] : null,
              hasLiveFile: own.some((file) => file.status === "live"),
              position: row.position,
            }
          : null,
    };
  });
}
