// Reading and writing entries (#85) inside one transaction. The use cases
// and the outcome handler lock the entry, ask the pure rules
// (./domain/submission.ts) what to do, and write the answer here: the
// status changes with one entry_transition row and one audit row each, and
// the event that tells the participant.
//
// Loads under plain Node (the worker): relative imports only.

import { asc, desc, eq, inArray } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  entry,
  entryFile,
  entryTransition,
  fileAsset,
  fileProcessing,
  participantProfile,
  type EntryFileRow,
  type EntryRow,
} from "../../db/schema";
import { monotonicUuidv7 } from "../../ids";
import { mediaJobFor } from "../files/domain/media-work";
import { emit } from "../../outbox/emit";
import type { Clock } from "../../ports/clock";
import { outcomesOf } from "./domain/file-outcome";
import {
  moveEntry,
  moveEntryFile,
  type EntryFileStatus,
  type EntryStatus,
  type EntryTrigger,
} from "./domain/status";
import {
  decideFileOutcome,
  type EntryEvent,
  type EntrySnapshot,
} from "./domain/submission";

/** UUIDv7 identity for entry files and transitions. */
export const nextEntryRowId = monotonicUuidv7();

/** The platform applying a file's outcome: the worker. */
export const WORKER: Actor = { kind: "system", process: "worker" };

export type LockedEntry = { row: EntryRow; files: EntryFileRow[] };

async function filesOf(tx: AppDb, entryId: string): Promise<EntryFileRow[]> {
  return tx
    .select()
    .from(entryFile)
    .where(eq(entryFile.entryId, entryId))
    .orderBy(asc(entryFile.attemptNumber));
}

/** The registration's entry and its files, locked until the transaction ends. */
export async function lockEntryOfRegistration(
  tx: AppDb,
  registrationId: string
): Promise<LockedEntry | null> {
  const [row] = await tx
    .select()
    .from(entry)
    .where(eq(entry.registrationId, registrationId))
    .for("update");
  return row ? { row, files: await filesOf(tx, row.id) } : null;
}

/** The entry and its files, locked until the transaction ends. */
export async function lockEntry(
  tx: AppDb,
  entryId: string
): Promise<LockedEntry | null> {
  const [row] = await tx
    .select()
    .from(entry)
    .where(eq(entry.id, entryId))
    .for("update");
  return row ? { row, files: await filesOf(tx, row.id) } : null;
}

export function snapshotOf({ row, files }: LockedEntry): EntrySnapshot {
  return {
    status: row.status,
    files: files.map((file) => ({ id: file.id, status: file.status })),
  };
}

const AUDIT_ACTION: Record<EntryTrigger, string> = {
  upload_completed: "entry.created",
  upload_retried: "entry.retried",
  file_live: "entry.submitted",
  file_infected: "entry.rejected",
  file_failed: "entry.failed",
  school_shortlisted: "entry.school_shortlisted",
  sent_to_foa: "entry.submitted_to_foa",
  not_shortlisted: "entry.not_shortlisted",
  essay_typed: "entry.submitted",
  school_round_reopened: "entry.school_round_reopened",
  forwarded_to_foa: "entry.submitted_to_foa",
  foa_verified: "entry.foa_verified",
  sent_back: "entry.sent_back",
  resubmitted: "entry.resubmitted",
  resubmission_live: "entry.returned_to_foa",
};

/** Records a status change while the entry is locked or newly inserted. */
export async function recordMove(
  tx: AppDb,
  ctx: { clock: Clock; actor: Actor },
  move: {
    entryId: string;
    from: EntryStatus | null;
    to: EntryStatus;
    trigger: EntryTrigger;
    /** The file whose upload or outcome moved it; null for a school round's move. */
    entryFileId: string | null;
    actorRole: Role | null;
    /** More for the audit row's `after`, such as a send-back's reason (#92). */
    details?: Record<string, unknown>;
  }
): Promise<void> {
  moveEntry(move.from, move.to);
  const [previous] = await tx
    .select({ sequence: entryTransition.sequence })
    .from(entryTransition)
    .where(eq(entryTransition.entryId, move.entryId))
    .orderBy(desc(entryTransition.sequence))
    .limit(1);
  const now = ctx.clock.now();
  await tx.insert(entryTransition).values({
    id: nextEntryRowId(now),
    entryId: move.entryId,
    sequence: (previous?.sequence ?? 0) + 1,
    fromStatus: move.from,
    toStatus: move.to,
    trigger: move.trigger,
    entryFileId: move.entryFileId,
    actorKind: ctx.actor.kind === "user" ? "user" : "system",
    actorUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
    at: now,
  });
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTION[move.trigger],
    entity: { type: "entry", id: move.entryId },
    before: { status: move.from },
    after: {
      status: move.to,
      entryFileId: move.entryFileId,
      ...move.details,
    },
    actorRole: move.actorRole,
  });
}

/** File moves have their own audit history, including moves on a submitted entry. */
export function recordFileMove(
  tx: AppDb,
  ctx: { clock: Clock; actor: Actor },
  move: {
    entryId: string;
    entryFileId: string;
    from: EntryFileStatus | null;
    to: EntryFileStatus;
    actorRole: Role | null;
  }
): Promise<void> {
  moveEntryFile(move.from, move.to);
  return recordAudit(tx, ctx, {
    action: "entry_file.status_changed",
    entity: { type: "entry_file", id: move.entryFileId },
    before: { status: move.from },
    after: { entryId: move.entryId, status: move.to },
    actorRole: move.actorRole,
  });
}

export async function supersedeEntryFiles(
  tx: AppDb,
  ctx: { clock: Clock; actor: Actor },
  files: readonly EntryFileRow[],
  ids: string[],
  actorRole: Role | null
): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(entryFile)
    .set({
      status: "superseded",
      pendingText: null,
      updatedAt: ctx.clock.now(),
    })
    .where(inArray(entryFile.id, ids));
  for (const file of files.filter((file) => ids.includes(file.id))) {
    await recordFileMove(tx, ctx, {
      entryId: file.entryId,
      entryFileId: file.id,
      from: file.status,
      to: "superseded",
      actorRole,
    });
  }
}

const TRIGGER_FOR: Partial<Record<EntryStatus, EntryTrigger>> = {
  submitted: "file_live",
  rejected: "file_infected",
  failed: "file_failed",
};

/** The outbox event a rule's event becomes, if any. */
function outboxEvent(
  event: EntryEvent,
  ids: { entryId: string; entryFileId: string; registrationId: string }
) {
  const aggregate = { type: "entry", id: ids.entryId } as const;
  switch (event) {
    case "entry.submitted":
      return { type: "entry.submitted", aggregate, payload: ids } as const;
    case "entry.rejected":
    case "entry.replacement_rejected":
      return {
        type: "entry.file_rejected",
        aggregate,
        payload: { ...ids, replacement: event !== "entry.rejected" },
      } as const;
    case "entry.failed":
    case "entry.replacement_failed":
      return {
        type: "entry.file_failed",
        aggregate,
        payload: { ...ids, replacement: event !== "entry.failed" },
      } as const;
    case "entry.replacement_live":
      return {
        type: "entry.replacement_live",
        aggregate,
        payload: { entryId: ids.entryId, entryFileId: ids.entryFileId },
      } as const;
  }
}

/**
 * Brings one of a locked entry's files up to date with what the Files
 * module has decided about its upload: every outcome so far, in order.
 * A file is attached before work is dispatched, so each later verdict
 * finds that attachment and waits its turn on the entry lock. An outcome
 * already applied, or for a file a newer upload dropped, changes nothing.
 */
export async function settleEntryFile(
  tx: AppDb,
  clock: Clock,
  locked: LockedEntry,
  entryFileId: string
): Promise<LockedEntry> {
  const target = locked.files.find((file) => file.id === entryFileId);
  if (!target?.fileAssetId) return locked;
  const [state] = await tx
    .select({
      status: fileAsset.status,
      purpose: fileAsset.purpose,
      contentType: fileAsset.contentType,
      processing: fileProcessing.status,
      ownerKind: participantProfile.ownerKind,
    })
    .from(fileAsset)
    .leftJoin(fileProcessing, eq(fileProcessing.fileAssetId, fileAsset.id))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, locked.row.participantProfileId)
    )
    .where(eq(fileAsset.id, target.fileAssetId))
    .for("share", { of: fileAsset });
  if (!state) return locked;

  const audit = { clock, actor: WORKER };
  let current = locked;
  const hasMediaJob = mediaJobFor(state) !== null;
  for (const outcome of outcomesOf({ ...state, hasMediaJob })) {
    const decision = decideFileOutcome(
      snapshotOf(current),
      entryFileId,
      outcome
    );
    if (!decision.applies) continue;
    const now = clock.now();
    const { row } = current;
    const publishedText = decision.file === "live" ? target.pendingText : null;
    const receiptTitle =
      decision.event === "entry.submitted" && state.ownerKind === "self"
        ? (publishedText?.title ?? row.title)
        : undefined;
    // Before the new file goes live: one live file per entry.
    await supersedeEntryFiles(
      tx,
      audit,
      current.files,
      decision.supersede,
      null
    );
    await tx
      .update(entryFile)
      .set({
        status: decision.file,
        ...(decision.file === "processing" ? {} : { pendingText: null }),
        ...(decision.file === "live" ? { becameLiveAt: now } : {}),
        receiptTitle,
        updatedAt: now,
      })
      .where(eq(entryFile.id, entryFileId));
    await recordFileMove(tx, audit, {
      entryId: row.id,
      entryFileId,
      from: current.files.find((file) => file.id === entryFileId)!.status,
      to: decision.file,
      actorRole: null,
    });
    const entryChanges = {
      ...publishedText,
      ...(decision.entry ? { status: decision.entry } : {}),
      ...(decision.entry === "submitted" ? { submittedAt: now } : {}),
      updatedAt: now,
    };
    if (decision.entry || publishedText) {
      await tx.update(entry).set(entryChanges).where(eq(entry.id, row.id));
    }
    if (decision.entry) {
      await recordMove(tx, audit, {
        entryId: row.id,
        from: row.status,
        to: decision.entry,
        trigger: TRIGGER_FOR[decision.entry]!,
        entryFileId,
        actorRole: null,
      });
    }
    const event =
      decision.event &&
      (decision.event !== "entry.replacement_live" ||
        row.status === "sent_back") &&
      outboxEvent(decision.event, {
        entryId: row.id,
        entryFileId,
        registrationId: row.registrationId,
      });
    if (event) await emit(tx, clock, event);
    current = {
      row: decision.entry || publishedText ? { ...row, ...entryChanges } : row,
      files: current.files.map((file) =>
        file.id === entryFileId
          ? { ...file, status: decision.file }
          : decision.supersede.includes(file.id)
            ? { ...file, status: "superseded" }
            : file
      ),
    };
  }
  return current;
}

/** The entry file for an uploaded file, if it is an entry's. */
export async function entryFileOf(
  db: AppDb,
  fileAssetId: string
): Promise<{ id: string; entryId: string } | undefined> {
  const [row] = await db
    .select({ id: entryFile.id, entryId: entryFile.entryId })
    .from(entryFile)
    .where(eq(entryFile.fileAssetId, fileAssetId));
  return row;
}
