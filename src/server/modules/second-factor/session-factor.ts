// Reading and recording where a user and their session stand with the
// second factor. Loads under plain Node: relative imports only.

import { and, eq, isNotNull } from "drizzle-orm";

import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import {
  secondFactor,
  secondFactorLockout,
  sessionSecondFactor,
  type SecondFactorKind,
} from "../../db/schema";
import { DomainError } from "../../errors";
import type { SecondFactorStatus } from "./domain/gate";
import { NO_FAILURES, type LockoutState } from "./domain/lockout";

export type SignedInUser = Extract<Actor, { kind: "user" }>;

/** The actor as a signed-in user; anyone else is refused. */
export function signedInUser(actor: Actor): SignedInUser {
  if (actor.kind !== "user") {
    throw new DomainError("forbidden", `${actor.kind} has no second factor`);
  }
  return actor;
}

/** Whether `userId` holds a confirmed factor, of any kind. */
export async function isEnrolled(db: AppDb, userId: string): Promise<boolean> {
  const [factor] = await db
    .select({ id: secondFactor.id })
    .from(secondFactor)
    .where(
      and(eq(secondFactor.userId, userId), isNotNull(secondFactor.confirmedAt))
    )
    .limit(1);
  return factor !== undefined;
}

/** When the session last passed a second factor, or null. */
export async function sessionVerifiedAt(
  db: AppDb,
  sessionId: string
): Promise<Date | null> {
  const [stamp] = await db
    .select({ verifiedAt: sessionSecondFactor.verifiedAt })
    .from(sessionSecondFactor)
    .where(eq(sessionSecondFactor.sessionId, sessionId));
  return stamp?.verifiedAt ?? null;
}

/** The user's factors and this session's stamp, read fresh on every call. */
export async function secondFactorStatus(
  db: AppDb,
  actor: SignedInUser
): Promise<SecondFactorStatus> {
  const [enrolled, verifiedAt] = await Promise.all([
    isEnrolled(db, actor.userId),
    sessionVerifiedAt(db, actor.sessionId),
  ]);
  // A stamp left from a factor since removed counts for nothing.
  return { enrolled, verifiedAt: enrolled ? verifiedAt : null };
}

/** Records that the session passed a second factor at `at`. */
export async function stampSession(
  db: AppDb,
  sessionId: string,
  at: Date,
  method: SecondFactorKind
): Promise<void> {
  await db
    .insert(sessionSecondFactor)
    .values({ sessionId, verifiedAt: at, method })
    .onConflictDoUpdate({
      target: sessionSecondFactor.sessionId,
      set: { verifiedAt: at, method },
    });
}

/**
 * The user's failed-code count, with their row locked until the
 * transaction ends, so two attempts at once can't both slip under the
 * limit.
 */
export async function lockLockout(
  tx: AppDb,
  userId: string
): Promise<LockoutState> {
  await tx
    .insert(secondFactorLockout)
    .values({ userId, failures: 0 })
    .onConflictDoNothing();
  const [row] = await tx
    .select({
      failures: secondFactorLockout.failures,
      windowStartedAt: secondFactorLockout.windowStartedAt,
      lockedUntil: secondFactorLockout.lockedUntil,
    })
    .from(secondFactorLockout)
    .where(eq(secondFactorLockout.userId, userId))
    .for("update");
  return row ?? NO_FAILURES;
}

export async function saveLockout(
  tx: AppDb,
  userId: string,
  state: LockoutState
): Promise<void> {
  await tx
    .update(secondFactorLockout)
    .set(state)
    .where(eq(secondFactorLockout.userId, userId));
}

/** Seconds until `until`, rounded up, so a wait is never under-reported. */
export function secondsUntil(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}
