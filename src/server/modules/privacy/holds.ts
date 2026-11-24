// Legal holds (#114). While a hold is in force on a person's account, a
// participant's profile or an institution, the retention sweep keeps every
// record about them past its period, and counts it as held. A super admin
// places and releases holds with a fresh second factor (#60); each is
// audited by ids only, since the reason is free text and stays in the
// hold's own row (listed in the data inventory).
//
//   placeLegalHold({ subjectType, subjectId, reason }) → the new hold's id
//   releaseLegalHold({ holdId })                       → releases it
//   listLegalHolds()                                   → holds in force
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  institution,
  legalHold,
  participantProfile,
  user,
  type LegalHoldSubjectType,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { lockLiveSession } from "../second-factor/session-factor";
import type { ActiveLegalHold } from "./domain/retention-plan";
import {
  legalHoldCursor,
  placeLegalHoldInput,
  releaseLegalHoldInput,
  type PlaceLegalHoldInput,
} from "./hold-input";

export type HoldsContext = Pick<UseCaseContext, "db" | "clock" | "actor">;

/** Serialise a sweep batch with changes to the holds it has to respect. */
export async function lockRetentionHolds(tx: AppDb): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(114, 1)`);
}

/** Every hold in force, as the sweep matches candidates against them. */
export async function activeLegalHolds(db: AppDb): Promise<ActiveLegalHold[]> {
  return db
    .select({
      subjectType: legalHold.subjectType,
      subjectId: legalHold.subjectId,
    })
    .from(legalHold)
    .where(isNull(legalHold.releasedAt));
}

/** A concurrent grant revocation either wins this check or waits for it. */
async function authorizeHoldChange(
  tx: AppDb,
  ctx: HoldsContext,
  action: "privacy.hold.place" | "privacy.hold.release"
) {
  if (ctx.actor.kind === "user") {
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, ctx.actor.userId))
      .for("share");
    await lockLiveSession(tx, ctx.actor, ctx.clock);
  }
  return authorize({ ...ctx, db: tx }, action);
}

export type PlaceLegalHoldResult =
  | { ok: true; holdId: string }
  | InvalidInput
  | { ok: false; error: "subject_not_found" | "already_held" };

/** Whether the account, profile or institution exists. */
async function subjectExists(
  db: AppDb,
  type: LegalHoldSubjectType,
  id: string
): Promise<boolean> {
  const table = {
    user,
    participant_profile: participantProfile,
    institution,
  }[type];
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, id));
  return row !== undefined;
}

export async function placeLegalHold(
  ctx: HoldsContext,
  input: PlaceLegalHoldInput
): Promise<PlaceLegalHoldResult> {
  await authorize(ctx, "privacy.hold.place");
  const parsed = placeLegalHoldInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { subjectType, subjectId, reason } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    await lockRetentionHolds(tx);
    const { role: actorRole } = await authorizeHoldChange(
      tx,
      ctx,
      "privacy.hold.place"
    );
    if (!(await subjectExists(tx, subjectType, subjectId))) {
      return { ok: false, error: "subject_not_found" } as const;
    }
    const now = ctx.clock.now();
    const [placed] = await tx
      .insert(legalHold)
      .values({
        id: uuidv7(now),
        subjectType,
        subjectId,
        reason,
        placedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        placedAt: now,
      })
      // One hold in force per subject (legal_hold_one_active_per_subject).
      .onConflictDoNothing()
      .returning({ id: legalHold.id });
    if (!placed) return { ok: false, error: "already_held" } as const;
    await recordAudit(tx, ctx, {
      action: "privacy.hold_placed",
      entity: { type: "legal_hold", id: placed.id },
      before: null,
      after: { subjectType, subjectId },
      actorRole,
    });
    return { ok: true, holdId: placed.id } as const;
  });
}

export type ReleaseLegalHoldResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: "not_found" | "already_released" };

export async function releaseLegalHold(
  ctx: HoldsContext,
  input: { holdId: string }
): Promise<ReleaseLegalHoldResult> {
  await authorize(ctx, "privacy.hold.release");
  const parsed = releaseLegalHoldInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { holdId } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    await lockRetentionHolds(tx);
    const { role: actorRole } = await authorizeHoldChange(
      tx,
      ctx,
      "privacy.hold.release"
    );
    const now = ctx.clock.now();
    const [released] = await tx
      .update(legalHold)
      .set({
        releasedAt: now,
        releasedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      })
      .where(and(eq(legalHold.id, holdId), isNull(legalHold.releasedAt)))
      .returning({
        subjectType: legalHold.subjectType,
        subjectId: legalHold.subjectId,
      });
    if (!released) {
      const [exists] = await tx
        .select({ id: legalHold.id })
        .from(legalHold)
        .where(eq(legalHold.id, holdId));
      return {
        ok: false,
        error: exists ? "already_released" : "not_found",
      } as const;
    }
    await recordAudit(tx, ctx, {
      action: "privacy.hold_released",
      entity: { type: "legal_hold", id: holdId },
      before: {
        subjectType: released.subjectType,
        subjectId: released.subjectId,
      },
      after: null,
      actorRole,
    });
    return { ok: true } as const;
  });
}

/** A hold in force, as the privacy page lists it. */
export type LegalHoldView = {
  id: string;
  subjectType: LegalHoldSubjectType;
  subjectId: string;
  reason: string;
  placedAt: Date;
  /** Null once the super admin's account is deleted. */
  placedBy: { id: string; name: string } | null;
};

export type LegalHoldPage = {
  holds: LegalHoldView[];
  nextCursor: string | null;
};

const PAGE_SIZE = 50;

/** One page of holds in force, oldest first. */
export async function listLegalHolds(
  ctx: HoldsContext,
  cursor?: string
): Promise<LegalHoldPage> {
  await authorize(ctx, "privacy.hold.view");
  const after = legalHoldCursor(cursor);
  const rows = await ctx.db
    .select({
      id: legalHold.id,
      subjectType: legalHold.subjectType,
      subjectId: legalHold.subjectId,
      reason: legalHold.reason,
      placedAt: legalHold.placedAt,
      placedById: user.id,
      placedByName: user.name,
      // Preserve database precision and allow resuming after the hold is released.
      cursorAt: sql<string>`to_char(${legalHold.placedAt} AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(legalHold)
    .leftJoin(user, eq(user.id, legalHold.placedByUserId))
    .where(
      and(
        isNull(legalHold.releasedAt),
        after
          ? sql`(${legalHold.placedAt}, ${legalHold.id}) > (${after.at}::timestamptz, ${after.id}::uuid)`
          : undefined
      )
    )
    .orderBy(asc(legalHold.placedAt), asc(legalHold.id))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    holds: page.map(
      ({ cursorAt: _cursorAt, placedById, placedByName, ...hold }) => ({
        ...hold,
        placedBy:
          placedById && placedByName !== null
            ? { id: placedById, name: placedByName }
            : null,
      })
    ),
    nextCursor:
      last && rows.length > PAGE_SIZE ? `${last.cursorAt}_${last.id}` : null,
  };
}
