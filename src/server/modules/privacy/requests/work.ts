// What the grievance officer does with a request (#115a).
//
//   assignPrivacyRequest({ id, assigneeUserId }) → give it to an officer;
//                                                  starts it if new
//   startPrivacyRequest({ id })                  → take it oneself
//   addPrivacyRequestNote({ id, body })          → an internal note
//   rejectPrivacyRequest({ id, reason })         → refuse it, saying why
//   completeCorrection({ id, resolution })       → a correction is done
//
// Each locks the request's row, follows the transition table
// (./domain/request-status.ts) and writes its audit row through
// `withOfficer`; a refused step writes nothing. The officer corrects the
// data itself on the owning module's own screens: no generic editor here
// can bypass another module's rules. Access and erasure requests complete
// through their export and erasure (./export.ts, ./erasure.ts).
//
// Loads under plain Node: relative imports only, no "server-only".

import { count, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../../../db/app-db";
import { privacyRequest, privacyRequestNote } from "../../../db/schema";
import { monotonicUuidv7 } from "../../../ids";
import { invalidInput, type InvalidInput } from "../../../input";
import { emit } from "../../../outbox";
import type { UseCaseContext } from "../../../use-cases";
import {
  NOTE_MAX,
  REJECTION_REASON_MAX,
  RESOLUTION_MAX,
  seal,
} from "./content";
import { privacyRequestAuditSnapshot } from "./domain/audit";
import {
  decideRequestTransition,
  type PrivacyRequestStatus,
  type RequestTransitionRefusal,
} from "./domain/request-status";
import { isGrievanceOfficer } from "./people";
import { lockRequest, NOT_FOUND, withOfficer } from "./with-officer";

/** Notes written in one millisecond still list in the order written. */
const nextNoteId = monotonicUuidv7();

const idInput = z.strictObject({ id: z.uuid() });

export type MoveResult =
  | { ok: true; status: PrivacyRequestStatus }
  | InvalidInput
  | { ok: false; error: RequestTransitionRefusal | "not_found" };

async function notesOn(tx: AppDb, requestId: string): Promise<number> {
  const [row] = await tx
    .select({ notes: count() })
    .from(privacyRequestNote)
    .where(eq(privacyRequestNote.requestId, requestId));
  return row?.notes ?? 0;
}

export type AssignPrivacyRequestResult =
  | { ok: true; changed: boolean; status: PrivacyRequestStatus }
  | InvalidInput
  | {
      ok: false;
      error: RequestTransitionRefusal | "not_found" | "assignee_not_officer";
    };

const assignInput = z.strictObject({
  id: z.uuid(),
  assigneeUserId: z.uuid(),
});

/**
 * Gives an open request to a grievance officer (the caller or another).
 * A new request starts with it; the same assignee again changes nothing.
 */
export async function assignPrivacyRequest(
  ctx: UseCaseContext,
  input: { id: string; assigneeUserId: string }
): Promise<AssignPrivacyRequestResult> {
  return withOfficer<AssignPrivacyRequestResult>(
    ctx,
    "privacy_request.assign",
    async (tx) => {
      const parsed = assignInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const { id, assigneeUserId } = parsed.data;
      const row = await lockRequest(tx, id);
      if (!row) return { result: NOT_FOUND };
      const decision = decideRequestTransition({
        from: row.status,
        event: "assign",
        type: row.type,
      });
      if (!decision.ok) {
        return { result: { ok: false, error: decision.reason } as const };
      }
      if (row.assignedToUserId === assigneeUserId) {
        return {
          result: { ok: true, changed: false, status: row.status } as const,
        };
      }
      if (!(await isGrievanceOfficer(tx, assigneeUserId))) {
        return {
          result: { ok: false, error: "assignee_not_officer" } as const,
        };
      }
      const now = ctx.clock.now();
      const [updated] = await tx
        .update(privacyRequest)
        .set({
          assignedToUserId: assigneeUserId,
          status: decision.to,
          startedAt: row.startedAt ?? now,
          updatedAt: now,
        })
        .where(eq(privacyRequest.id, id))
        .returning();
      return {
        result: { ok: true, changed: true, status: decision.to } as const,
        audit: {
          action: "privacy_request.assigned",
          entity: { type: "privacy_request", id },
          before: privacyRequestAuditSnapshot(row),
          after: privacyRequestAuditSnapshot(updated!),
        },
      };
    }
  );
}

/** The officer takes a new request themselves and starts it. */
export async function startPrivacyRequest(
  ctx: UseCaseContext,
  input: { id: string }
): Promise<MoveResult> {
  return withOfficer<MoveResult>(
    ctx,
    "privacy_request.start",
    async (tx, officer) => {
      const parsed = idInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const row = await lockRequest(tx, parsed.data.id);
      if (!row) return { result: NOT_FOUND };
      const decision = decideRequestTransition({
        from: row.status,
        event: "start",
        type: row.type,
      });
      if (!decision.ok) {
        return { result: { ok: false, error: decision.reason } as const };
      }
      const now = ctx.clock.now();
      const [updated] = await tx
        .update(privacyRequest)
        .set({
          status: decision.to,
          assignedToUserId: officer.userId,
          startedAt: now,
          updatedAt: now,
        })
        .where(eq(privacyRequest.id, row.id))
        .returning();
      return {
        result: { ok: true, status: decision.to } as const,
        audit: {
          action: "privacy_request.started",
          entity: { type: "privacy_request", id: row.id },
          before: privacyRequestAuditSnapshot(row),
          after: privacyRequestAuditSnapshot(updated!),
        },
      };
    }
  );
}

export type AddPrivacyRequestNoteResult =
  | { ok: true; noteId: string }
  | InvalidInput
  | { ok: false; error: "not_found" };

const noteInput = z.strictObject({
  id: z.uuid(),
  body: z.string().trim().min(1).max(NOTE_MAX),
});

/**
 * Appends an internal note. Notes are never shown to the requester and
 * never edited; one may be added to a closed request, as a later fact.
 */
export async function addPrivacyRequestNote(
  ctx: UseCaseContext,
  input: { id: string; body: string }
): Promise<AddPrivacyRequestNoteResult> {
  return withOfficer<AddPrivacyRequestNoteResult>(
    ctx,
    "privacy_request.note",
    async (tx, officer) => {
      const parsed = noteInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const { id, body } = parsed.data;
      const row = await lockRequest(tx, id);
      if (!row) return { result: NOT_FOUND };
      const before = await notesOn(tx, id);
      const now = ctx.clock.now();
      const noteId = nextNoteId(now);
      await tx.insert(privacyRequestNote).values({
        id: noteId,
        requestId: id,
        authorUserId: officer.userId,
        body: seal(ctx.cipher, "noteBody", body),
        createdAt: now,
      });
      return {
        result: { ok: true, noteId } as const,
        audit: {
          action: "privacy_request.note_added",
          entity: { type: "privacy_request", id },
          before: privacyRequestAuditSnapshot(row, { notes: before }),
          after: privacyRequestAuditSnapshot(row, { notes: before + 1 }),
        },
      };
    }
  );
}

const rejectInput = z.strictObject({
  id: z.uuid(),
  reason: z.string().trim().min(1).max(REJECTION_REASON_MAX),
});

/** Refuses an open request; the requester reads the reason. */
export async function rejectPrivacyRequest(
  ctx: UseCaseContext,
  input: { id: string; reason: string }
): Promise<MoveResult> {
  return withOfficer<MoveResult>(ctx, "privacy_request.reject", async (tx) => {
    const parsed = rejectInput.safeParse(input);
    if (!parsed.success) return { result: invalidInput(parsed.error) };
    const { id, reason } = parsed.data;
    const row = await lockRequest(tx, id);
    if (!row) return { result: NOT_FOUND };
    const decision = decideRequestTransition({
      from: row.status,
      event: "reject",
      type: row.type,
    });
    if (!decision.ok) {
      return { result: { ok: false, error: decision.reason } as const };
    }
    const now = ctx.clock.now();
    const [updated] = await tx
      .update(privacyRequest)
      .set({
        status: decision.to,
        rejectionReason: seal(ctx.cipher, "rejectionReason", reason),
        closedAt: now,
        updatedAt: now,
      })
      .where(eq(privacyRequest.id, id))
      .returning();
    await emit(tx, ctx.clock, {
      type: "privacy_request.rejected",
      aggregate: { type: "privacy_request", id },
      payload: { requestId: id },
    });
    return {
      result: { ok: true, status: decision.to } as const,
      audit: {
        action: "privacy_request.rejected",
        entity: { type: "privacy_request", id },
        before: privacyRequestAuditSnapshot(row),
        after: privacyRequestAuditSnapshot(updated!),
      },
    };
  });
}

export type CompleteCorrectionResult =
  | MoveResult
  | { ok: false; error: "completed_by_export_or_erasure" };

const correctionInput = z.strictObject({
  id: z.uuid(),
  resolution: z.string().trim().min(1).max(RESOLUTION_MAX),
});

/**
 * Records that a correction is done, with what was corrected, which the
 * requester reads. Access and erasure requests complete by their export
 * and erasure instead.
 */
export async function completeCorrection(
  ctx: UseCaseContext,
  input: { id: string; resolution: string }
): Promise<CompleteCorrectionResult> {
  return withOfficer<CompleteCorrectionResult>(
    ctx,
    "privacy_request.complete_correction",
    async (tx) => {
      const parsed = correctionInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const { id, resolution } = parsed.data;
      const row = await lockRequest(tx, id);
      if (!row) return { result: NOT_FOUND };
      if (row.type !== "correction") {
        return {
          result: {
            ok: false,
            error: "completed_by_export_or_erasure",
          } as const,
        };
      }
      const decision = decideRequestTransition({
        from: row.status,
        event: "complete",
        type: row.type,
      });
      if (!decision.ok) {
        return { result: { ok: false, error: decision.reason } as const };
      }
      const now = ctx.clock.now();
      const [updated] = await tx
        .update(privacyRequest)
        .set({
          status: decision.to,
          resolution: seal(ctx.cipher, "resolution", resolution),
          closedAt: now,
          updatedAt: now,
        })
        .where(eq(privacyRequest.id, id))
        .returning();
      await emit(tx, ctx.clock, {
        type: "privacy_request.completed",
        aggregate: { type: "privacy_request", id },
        payload: { requestId: id },
      });
      return {
        result: { ok: true, status: decision.to } as const,
        audit: {
          action: "privacy_request.completed",
          entity: { type: "privacy_request", id },
          before: privacyRequestAuditSnapshot(row),
          after: privacyRequestAuditSnapshot(updated!),
        },
      };
    }
  );
}
