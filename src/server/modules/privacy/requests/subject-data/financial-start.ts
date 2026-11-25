// A donation started during an approved erasure must not create another
// recognition choice or mandate behind the erasure's final check.
import { and, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import type { AppDb } from "../../../../db/app-db";
import {
  erasureRecord,
  participantProfile,
  privacyRequest,
  user,
} from "../../../../db/schema";
import { lockSubject } from "../submit";

export async function financialStartAllowed(
  db: AppDb,
  userId: string,
  startedAt: Date
) {
  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId));
  if (!account) return false;
  const [pending] = await db
    .select({ id: privacyRequest.id })
    .from(privacyRequest)
    .where(
      and(
        eq(privacyRequest.type, "erasure"),
        eq(privacyRequest.status, "in_progress"),
        isNotNull(privacyRequest.erasureFingerprint),
        or(
          and(
            eq(privacyRequest.subjectKind, "user"),
            eq(privacyRequest.subjectId, userId)
          ),
          and(
            eq(privacyRequest.subjectKind, "participant_profile"),
            sql`${privacyRequest.subjectId} IN (SELECT ${participantProfile.id} FROM ${participantProfile} WHERE ${participantProfile.loginUserId} = ${userId})`
          )
        )
      )
    )
    .limit(1);
  if (pending) return false;
  // A start whose gateway call straddled erasure can't insert a new record
  // after the worker released its lock, even for a retained payer account.
  const [finished] = await db
    .select({ id: erasureRecord.id })
    .from(erasureRecord)
    .where(
      and(
        sql`${userId}::uuid = ANY(${erasureRecord.userIds})`,
        gte(erasureRecord.erasedAt, startedAt)
      )
    )
    .limit(1);
  return !finished;
}

/** Recheck while serialised with the erasure worker, before a gift is saved. */
export async function lockFinancialStart(
  db: AppDb,
  userId: string,
  startedAt: Date
) {
  await lockSubject(db, userId);
  return financialStartAllowed(db, userId, startedAt);
}

export const donationStartAllowed = financialStartAllowed;
export const lockDonationStart = lockFinancialStart;
