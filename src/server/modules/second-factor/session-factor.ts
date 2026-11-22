// Reading and recording where a user and their session stand with the
// second factor. Loads under plain Node: relative imports only.

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import {
  secondFactor,
  secondFactorLockout,
  session,
  sessionSecondFactor,
  user,
  type SecondFactorKind,
} from "../../db/schema";
import { DomainError } from "../../errors";
import type { Clock } from "../../ports/clock";
import type { SecondFactorStatus } from "./domain/gate";
import { NO_FAILURES, type LockoutState } from "./domain/lockout";
import { isLiveSession } from "./session-lifetimes";

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
 * Serializes factor changes for the user. This lock also makes a new
 * primary session's foreign key check wait for a reset or removal.
 */
export async function lockUser(tx: AppDb, userId: string): Promise<boolean> {
  return (await lockUsers(tx, [userId])).has(userId.toLowerCase());
}

/**
 * Locks several accounts as `lockUser` does, in id order in one statement,
 * so transactions locking the same accounts queue rather than deadlock
 * (role changes lock in the same order). Returns the ids found.
 */
export async function lockUsers(
  tx: AppDb,
  userIds: readonly string[]
): Promise<Set<string>> {
  const rows = await tx
    .select({ id: user.id })
    .from(user)
    .where(inArray(user.id, [...new Set(userIds)]))
    .orderBy(asc(user.id))
    .for("update");
  return new Set(rows.map((row) => row.id));
}

/**
 * Locks the actor's primary session until the transaction ends, so signing
 * it out waits for the transaction, and refuses one that ended since the
 * request resolved its actor. Lock the account first.
 */
export async function lockLiveSession(
  tx: AppDb,
  actor: SignedInUser,
  clock: Clock
): Promise<void> {
  const [primary] = await tx
    .select({
      userId: session.userId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    })
    .from(session)
    .where(
      and(eq(session.id, actor.sessionId), eq(session.userId, actor.userId))
    )
    .for("key share");
  if (!primary || !(await isLiveSession(tx, primary, clock.now()))) {
    throw new DomainError("forbidden", "The primary session has ended");
  }
}

/** Locks the account first and checks for revocation since the request resolved its actor. */
export async function lockFactorSession(
  tx: AppDb,
  actor: SignedInUser,
  clock: Clock
): Promise<void> {
  await lockUser(tx, actor.userId);
  await lockLiveSession(tx, actor, clock);
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
