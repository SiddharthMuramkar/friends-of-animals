// Recording a breach and moving it through its life (#116).
//
//   recordBreach(details)                   → a new open breach, led by the actor
//   updateBreach({ breachId, ...fields })   → corrects what staff recorded
//   addBreachTimelineEvent({ breachId, note }) → a note in the timeline
//   containBreach({ breachId })             → the cause is stopped
//   closeBreach({ breachId, reason? })      → nothing is left to do
//
// Changes lock the breach's row, so two staff acting at once queue. Moves
// follow the transition table (./domain/breach-status.ts). Notes may still
// be added to a closed breach: later facts belong in its timeline, not in
// an edit. Notices are ./notify.ts and ./authority.ts.
//
// Every change runs through `withBreachStaff`, appends a timeline event and
// writes one audit row (the record's lifecycle fields, flags and counts:
// never its title, impact or a note) in the same transaction. A refused
// change writes nothing.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../../db/app-db";
import {
  breachRecord,
  breachTimelineEvent,
  type BreachRecordRow,
} from "../../db/schema";
import { monotonicUuidv7, uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { Ciphertext } from "../../crypto/field-cipher";
import { openBreachText, sealBreachText } from "./content";
import { breachAuditSnapshot } from "./domain/audit";
import {
  BREACH_NOTE_MAX,
  BREACH_UPDATABLE_FIELDS,
  breachRecordSchema,
  decideBreachTransition,
  INITIAL_BREACH_STATUS,
  NO_NOTICE_REASON_MAX,
  type BreachStatus,
  type BreachTimelineKind,
  type BreachTransitionRefusal,
  type BreachUpdatableField,
} from "./domain/breach-status";
import { withBreachStaff, type BreachContext } from "./with-breach-staff";

/**
 * Timeline events written in one millisecond still list in the order they
 * were written (the timeline reads oldest first, by id within an instant).
 */
const nextTimelineId = monotonicUuidv7();

/** Appends one event to a breach's timeline. */
export async function appendTimeline(
  tx: AppDb,
  event: {
    breachId: string;
    kind: BreachTimelineKind;
    note?: Ciphertext | null;
    authorUserId: string | null;
    at: Date;
  }
): Promise<void> {
  await tx.insert(breachTimelineEvent).values({
    id: nextTimelineId(event.at),
    breachId: event.breachId,
    kind: event.kind,
    note: event.note ?? null,
    authorUserId: event.authorUserId,
    occurredAt: event.at,
  });
}

export type RecordBreachResult =
  | { ok: true; id: string }
  | InvalidInput
  | { ok: false; error: "aware_in_future" };

/**
 * Records a breach FOA has become aware of. It starts open, led by the
 * actor; `awareAt` may be earlier than now, never later.
 */
export async function recordBreach(
  ctx: BreachContext,
  input: unknown
): Promise<RecordBreachResult> {
  return withBreachStaff<RecordBreachResult>(
    ctx,
    "breach.record",
    async (tx, staff) => {
      const parsed = breachRecordSchema.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const details = parsed.data;
      const now = ctx.clock.now();
      if (details.awareAt.getTime() > now.getTime()) {
        return { result: { ok: false, error: "aware_in_future" } };
      }

      const id = uuidv7(now);
      const [created] = await tx
        .insert(breachRecord)
        .values({
          id,
          title: details.title,
          awareAt: details.awareAt,
          severity: details.severity,
          personalDataInvolved: details.personalDataInvolved,
          minorsAffected: details.minorsAffected,
          affectedCount: details.affectedCount,
          impact: sealBreachText(ctx.cipher, "impact", details.impact),
          status: INITIAL_BREACH_STATUS,
          leadUserId: staff.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error("The breach record was not written");
      await appendTimeline(tx, {
        breachId: id,
        kind: "recorded",
        authorUserId: staff.userId,
        at: now,
      });
      return {
        result: { ok: true, id },
        audit: {
          action: "breach.recorded",
          breachId: id,
          before: null,
          after: breachAuditSnapshot(created),
        },
      };
    }
  );
}

/** The breach's row, locked until the transaction ends. */
export async function lockBreach(
  tx: AppDb,
  breachId: string
): Promise<BreachRecordRow | undefined> {
  const [row] = await tx
    .select()
    .from(breachRecord)
    .where(eq(breachRecord.id, breachId))
    .for("update");
  return row;
}

export const NOT_FOUND = { ok: false, error: "not_found" } as const;
export const CLOSED = { ok: false, error: "breach_closed" } as const;

const breachId = z.uuid();

export type UpdateBreachResult =
  | { ok: true; changed: boolean }
  | InvalidInput
  | { ok: false; error: "not_found" | "breach_closed" };

const updateInput = breachRecordSchema
  .omit({ awareAt: true })
  .partial()
  .extend({ breachId });

/**
 * Corrects what was recorded: the title, severity, flags, the estimate of
 * people affected, the impact. When FOA became aware stays as recorded.
 * Values that already apply change and record nothing.
 */
export async function updateBreach(
  ctx: BreachContext,
  input: unknown
): Promise<UpdateBreachResult> {
  return withBreachStaff<UpdateBreachResult>(
    ctx,
    "breach.update",
    async (tx, staff) => {
      const parsed = updateInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const { breachId: id, ...fields } = parsed.data;

      const breach = await lockBreach(tx, id);
      if (!breach) return { result: NOT_FOUND };
      if (breach.status === "closed") return { result: CLOSED };

      const stored: Record<BreachUpdatableField, unknown> = {
        title: breach.title,
        severity: breach.severity,
        personalDataInvolved: breach.personalDataInvolved,
        minorsAffected: breach.minorsAffected,
        affectedCount: breach.affectedCount,
        impact: openBreachText(ctx.cipher, "impact", breach.impact),
      };
      const changed = BREACH_UPDATABLE_FIELDS.filter(
        (field) =>
          fields[field] !== undefined && fields[field] !== stored[field]
      );
      if (changed.length === 0) {
        return { result: { ok: true, changed: false } };
      }

      const now = ctx.clock.now();
      const [updated] = await tx
        .update(breachRecord)
        .set({
          ...(changed.includes("title") ? { title: fields.title } : {}),
          ...(changed.includes("severity")
            ? { severity: fields.severity }
            : {}),
          ...(changed.includes("personalDataInvolved")
            ? { personalDataInvolved: fields.personalDataInvolved }
            : {}),
          ...(changed.includes("minorsAffected")
            ? { minorsAffected: fields.minorsAffected }
            : {}),
          ...(changed.includes("affectedCount")
            ? { affectedCount: fields.affectedCount }
            : {}),
          ...(changed.includes("impact") && fields.impact !== undefined
            ? { impact: sealBreachText(ctx.cipher, "impact", fields.impact) }
            : {}),
          updatedAt: now,
        })
        .where(eq(breachRecord.id, id))
        .returning();
      if (!updated) throw new Error(`Breach ${id} vanished while locked`);
      await appendTimeline(tx, {
        breachId: id,
        kind: "updated",
        authorUserId: staff.userId,
        at: now,
      });
      return {
        result: { ok: true, changed: true },
        audit: {
          action: "breach.updated",
          breachId: id,
          before: breachAuditSnapshot(breach),
          after: breachAuditSnapshot(updated, { changedFields: changed }),
        },
      };
    }
  );
}

export type AddBreachTimelineEventResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: "not_found" };

const noteInput = z.strictObject({
  breachId,
  note: z.string().trim().min(1).max(BREACH_NOTE_MAX),
});

/** Adds a note to a breach's timeline, encrypted; open or closed. */
export async function addBreachTimelineEvent(
  ctx: BreachContext,
  input: unknown
): Promise<AddBreachTimelineEventResult> {
  return withBreachStaff<AddBreachTimelineEventResult>(
    ctx,
    "breach.note",
    async (tx, staff) => {
      const parsed = noteInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const breach = await lockBreach(tx, parsed.data.breachId);
      if (!breach) return { result: NOT_FOUND };
      await appendTimeline(tx, {
        breachId: breach.id,
        kind: "note",
        note: sealBreachText(ctx.cipher, "note", parsed.data.note),
        authorUserId: staff.userId,
        at: ctx.clock.now(),
      });
      const snapshot = breachAuditSnapshot(breach);
      return {
        result: { ok: true },
        audit: {
          action: "breach.timeline_entry_added",
          breachId: breach.id,
          before: snapshot,
          after: snapshot,
        },
      };
    }
  );
}

export type MoveBreachResult =
  | { ok: true; status: BreachStatus }
  | InvalidInput
  | { ok: false; error: BreachTransitionRefusal | "not_found" };

const containInput = z.strictObject({ breachId });

/**
 * Marks a breach contained. An open one becomes `contained`; a notified
 * one stays `notified` and keeps when it was contained.
 */
export async function containBreach(
  ctx: BreachContext,
  input: unknown
): Promise<MoveBreachResult> {
  return withBreachStaff<MoveBreachResult>(
    ctx,
    "breach.contain",
    async (tx, staff) => {
      const parsed = containInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const breach = await lockBreach(tx, parsed.data.breachId);
      if (!breach) return { result: NOT_FOUND };
      const decision = decideBreachTransition(breach, "contain");
      if (!decision.ok) {
        return { result: { ok: false, error: decision.reason } };
      }
      const now = ctx.clock.now();
      const [updated] = await tx
        .update(breachRecord)
        .set({ status: decision.to, containedAt: now, updatedAt: now })
        .where(eq(breachRecord.id, breach.id))
        .returning();
      if (!updated)
        throw new Error(`Breach ${breach.id} vanished while locked`);
      await appendTimeline(tx, {
        breachId: breach.id,
        kind: "contained",
        authorUserId: staff.userId,
        at: now,
      });
      return {
        result: { ok: true, status: decision.to },
        audit: {
          action: "breach.contained",
          breachId: breach.id,
          before: breachAuditSnapshot(breach),
          after: breachAuditSnapshot(updated),
        },
      };
    }
  );
}

const closeInput = z.strictObject({
  breachId,
  /** Why no notice was needed; required when none was sent. */
  reason: z.string().trim().max(NO_NOTICE_REASON_MAX).optional(),
});

/**
 * Closes a breach: a contained one no one needed telling about (with the
 * reason, kept encrypted in the timeline), or a notified one once it is
 * contained.
 */
export async function closeBreach(
  ctx: BreachContext,
  input: unknown
): Promise<MoveBreachResult> {
  return withBreachStaff<MoveBreachResult>(
    ctx,
    "breach.close",
    async (tx, staff) => {
      const parsed = closeInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const reason = parsed.data.reason || undefined;
      const breach = await lockBreach(tx, parsed.data.breachId);
      if (!breach) return { result: NOT_FOUND };
      const decision = decideBreachTransition(breach, "close", {
        noNoticeReason: reason,
      });
      if (!decision.ok) {
        return { result: { ok: false, error: decision.reason } };
      }
      const now = ctx.clock.now();
      const [updated] = await tx
        .update(breachRecord)
        .set({ status: decision.to, closedAt: now, updatedAt: now })
        .where(eq(breachRecord.id, breach.id))
        .returning();
      if (!updated)
        throw new Error(`Breach ${breach.id} vanished while locked`);
      await appendTimeline(tx, {
        breachId: breach.id,
        kind: "closed",
        note: reason ? sealBreachText(ctx.cipher, "note", reason) : null,
        authorUserId: staff.userId,
        at: now,
      });
      return {
        result: { ok: true, status: decision.to },
        audit: {
          action: "breach.closed",
          breachId: breach.id,
          before: breachAuditSnapshot(breach),
          after: breachAuditSnapshot(updated),
        },
      };
    }
  );
}
