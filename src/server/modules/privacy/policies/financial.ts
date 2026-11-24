// Financial records (#77, #79, #80): a payment, its offline record, its
// reviews and its refunds stay whole until 8 years after the end of the
// financial year of their last activity, a statutory floor no setting can
// shorten (HR-31, HR-47). Then the payer's account and every free-text or
// reference column the data inventory marks for this policy are blanked;
// the amounts, dates and statuses stay as the money's history. The proof
// file stays named by the offline payment (its column is NOT NULL,
// Decision 2): the paymentProofs lifecycle keeps it with the record.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  and,
  asc,
  eq,
  gt,
  inArray,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import type { AppDb } from "../../../db/app-db";
import {
  fileAsset,
  offlinePayment,
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  registration,
  refund,
} from "../../../db/schema";
import type { SubjectRef } from "../domain/retention-plan";
import { anonymiseSet, atOrBefore, instant, notYetAnonymised } from "./define";
import { nextCursor, type RetentionPolicy } from "./types";

const KEY = "financialRecords";

/** The tables hanging off a batch whose columns the policy blanks. */
const DEPENDENTS = [offlinePayment, paymentReviewCase, refund] as const;

function hasUnblanked(table: (typeof DEPENDENTS)[number]): SQL {
  return sql`EXISTS (SELECT 1 FROM ${table as PgTable} WHERE ${table.batchId} = ${paymentBatch.id} AND ${notYetAnonymised(KEY, table)})`;
}

const needsAnonymising = or(
  notYetAnonymised(KEY, paymentBatch),
  ...DEPENDENTS.map(hasUnblanked)
);

// An unfinished refund still needs its decision context and payment evidence.
const refundWorkflowClosed = sql`NOT EXISTS (
  SELECT 1 FROM ${refund}
  WHERE ${refund.batchId} = ${paymentBatch.id}
    AND ${notInArray(refund.status, ["rejected", "refunded"])}
)`;

// A review can still produce a capture and receipt for this payer.
const reviewWorkflowClosed = sql`NOT EXISTS (
  SELECT 1 FROM ${paymentReviewCase}
  WHERE ${paymentReviewCase.batchId} = ${paymentBatch.id}
    AND ${paymentReviewCase.resolvedAt} IS NULL
)`;

/**
 * The batch's last activity: the instant its financial year is read from.
 * Erasure (#115b) dates a payment's floor by it too.
 */
export const lastActivity = instant(
  sql`GREATEST(
    ${paymentBatch.updatedAt},
    (SELECT max(${refund.updatedAt}) FROM ${refund} WHERE ${refund.batchId} = ${paymentBatch.id}),
    (SELECT max(coalesce(${paymentReviewCase.resolvedAt}, ${paymentReviewCase.openedAt})) FROM ${paymentReviewCase} WHERE ${paymentReviewCase.batchId} = ${paymentBatch.id}),
    (SELECT max(${offlinePayment.recordedAt}) FROM ${offlinePayment} WHERE ${offlinePayment.batchId} = ${paymentBatch.id})
  )`,
  paymentBatch.updatedAt
);

export const FINANCIAL_RECORDS: RetentionPolicy = {
  key: KEY,
  table: "payment_batch",
  action: "anonymise",
  period: { kind: "timed", key: KEY },
  async candidates(db, { cutoff, after, limit }) {
    const locked = await db
      .select({ id: paymentBatch.id })
      .from(paymentBatch)
      .where(
        and(
          needsAnonymising,
          refundWorkflowClosed,
          reviewWorkflowClosed,
          atOrBefore(lastActivity, cutoff),
          after === null ? undefined : gt(paymentBatch.id, after.id)
        )
      )
      .orderBy(asc(paymentBatch.id))
      .limit(limit)
      .for("update", { of: paymentBatch });
    if (locked.length === 0) return { candidates: [], next: null };
    const ids = locked.map(({ id }) => id);
    const next = nextCursor(locked, limit);

    // A new refund takes the batch lock. Updates to existing refunds can
    // take only the refund lock, so lock those rows before re-reading the
    // last activity in a fresh statement.
    const refunds = await db
      .select({
        batchId: refund.batchId,
        requester: refund.requestedBy,
        decider: refund.decidedBy,
        recorder: refund.manualRecordedBy,
      })
      .from(refund)
      .where(inArray(refund.batchId, ids))
      .orderBy(asc(refund.id))
      .for("update");
    const eligible = await db
      .select({
        id: paymentBatch.id,
        anchor: lastActivity,
        payer: paymentBatch.payerUserId,
        institution: paymentBatch.institutionId,
      })
      .from(paymentBatch)
      .where(
        and(
          inArray(paymentBatch.id, ids),
          needsAnonymising,
          refundWorkflowClosed,
          reviewWorkflowClosed,
          atOrBefore(lastActivity, cutoff)
        )
      )
      .orderBy(asc(paymentBatch.id));
    if (eligible.length === 0) return { candidates: [], next };

    const eligibleIds = eligible.map(({ id }) => id);
    const offline = await db
      .select({
        batchId: offlinePayment.batchId,
        recorder: offlinePayment.recordedByUserId,
        proofOwner: fileAsset.ownerUserId,
      })
      .from(offlinePayment)
      .leftJoin(fileAsset, eq(fileAsset.id, offlinePayment.proofFileAssetId))
      .where(inArray(offlinePayment.batchId, eligibleIds));
    const reviews = await db
      .select({
        batchId: paymentReviewCase.batchId,
        resolver: paymentReviewCase.resolvedByUserId,
      })
      .from(paymentReviewCase)
      .where(inArray(paymentReviewCase.batchId, eligibleIds));

    const registrations = await db
      .selectDistinct({
        batchId: paymentBatchItem.batchId,
        profileId: registration.participantProfileId,
      })
      .from(paymentBatchItem)
      .innerJoin(
        registration,
        eq(registration.id, paymentBatchItem.registrationId)
      )
      .where(inArray(paymentBatchItem.batchId, eligibleIds));
    const profilesByBatch = new Map<string, SubjectRef[]>();
    for (const { batchId, profileId } of registrations) {
      const profiles = profilesByBatch.get(batchId) ?? [];
      profiles.push({ type: "participant_profile", id: profileId });
      profilesByBatch.set(batchId, profiles);
    }

    const usersByBatch = new Map<string, Set<string>>();
    function addUsers(batchId: string, ...userIds: (string | null)[]) {
      const users = usersByBatch.get(batchId) ?? new Set<string>();
      for (const id of userIds) if (id !== null) users.add(id);
      usersByBatch.set(batchId, users);
    }
    for (const row of offline)
      addUsers(row.batchId, row.recorder, row.proofOwner);
    for (const row of reviews) addUsers(row.batchId, row.resolver);
    for (const row of refunds) {
      addUsers(row.batchId, row.requester, row.decider, row.recorder);
    }
    const candidates = eligible.map(({ id, anchor, payer, institution }) => {
      addUsers(id, payer);
      const subjects: SubjectRef[] = [...usersByBatch.get(id)!].map(
        (userId) => ({
          type: "user",
          id: userId,
        })
      );
      if (institution !== null)
        subjects.push({ type: "institution", id: institution });
      subjects.push(...(profilesByBatch.get(id) ?? []));
      return { id, anchor, subjects };
    });
    return { candidates, next };
  },
  async apply(db: AppDb, ids) {
    if (ids.length === 0) return;
    const batches = [...ids];
    await db
      .update(paymentBatch)
      .set(anonymiseSet(KEY, paymentBatch))
      .where(inArray(paymentBatch.id, batches));
    await db
      .update(offlinePayment)
      .set(anonymiseSet(KEY, offlinePayment))
      .where(inArray(offlinePayment.batchId, batches));
    await db
      .update(paymentReviewCase)
      .set(anonymiseSet(KEY, paymentReviewCase))
      .where(inArray(paymentReviewCase.batchId, batches));
    await db
      .update(refund)
      .set(anonymiseSet(KEY, refund))
      .where(inArray(refund.batchId, batches));
  },
};
