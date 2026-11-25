// The daily overdue digest (#115a). Once a day the worker counts the open
// requests past their due time and gives each grievance officer one
// in-app nudge: how many are overdue, and how many of those are theirs.
// Counts only, never who a request is about. Nothing goes when nothing is
// overdue, and a second run on the same India day sends nothing more
// (`privacy_overdue_digest` holds one row per day).
//
//   flagOverduePrivacyRequests() → { sent }      (worker or CLI only)
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import { inArray } from "drizzle-orm";

import { authorize } from "../../../access/can";
import type { Actor } from "../../../actor";
import type { AppDb } from "../../../db/app-db";
import { privacyOverdueDigest, privacyRequest } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { emit } from "../../../outbox";
import type { ScheduleDefinition } from "../../../outbox/schedules";
import type { Clock } from "../../../ports/clock";
import { overdueDigests } from "./domain/due";
import { grievanceOfficers } from "./people";

export const FLAG_OVERDUE_JOB = "privacy.flag_overdue";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** `YYYY-MM-DD`: the India calendar day `at` falls on. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export type OverdueContext = { db: AppDb; clock: Clock; actor: Actor };

export async function flagOverduePrivacyRequests(
  ctx: OverdueContext
): Promise<{ sent: number }> {
  await authorize(ctx, "privacy_request.run_jobs");
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const open = await tx
      .select({
        status: privacyRequest.status,
        dueAt: privacyRequest.dueAt,
        assignedToUserId: privacyRequest.assignedToUserId,
      })
      .from(privacyRequest)
      .where(inArray(privacyRequest.status, ["submitted", "in_progress"]));
    const officers = await grievanceOfficers(tx);
    const digests = overdueDigests({
      now,
      officerIds: officers.map((officer) => officer.id),
      requests: open,
    });
    if (digests.length === 0) return { sent: 0 };

    const day = istDay(now);
    const [claimed] = await tx
      .insert(privacyOverdueDigest)
      .values({ day, overdue: digests[0]!.overdue, sentAt: now })
      .onConflictDoNothing()
      .returning({ day: privacyOverdueDigest.day });
    if (!claimed) return { sent: 0 };

    const runId = uuidv7(now);
    for (const digest of digests) {
      await emit(tx, ctx.clock, {
        type: "privacy_request.overdue_digest",
        aggregate: { type: "privacy_overdue_digest", id: runId },
        payload: {
          officerUserId: digest.userId,
          day,
          overdue: digest.overdue,
          assignedToYou: digest.assignedToYou,
        },
      });
    }
    return { sent: digests.length };
  });
}

const WORKER: Actor = { kind: "system", process: "worker" };

/** 09:00 IST, at the start of the officer's working day. */
export const flagOverdueSchedule: ScheduleDefinition = {
  name: FLAG_OVERDUE_JOB,
  cron: "0 9 * * *",
  tz: "Asia/Kolkata",
  retryLimit: 2,
  retryDelay: 15 * 60,
  async run(deps, job) {
    try {
      await flagOverduePrivacyRequests({
        db: deps.db,
        clock: deps.clock,
        actor: WORKER,
      });
    } catch (error) {
      if (job?.finalAttempt ?? true) {
        deps.errors.report(error, {
          where: FLAG_OVERDUE_JOB,
          tags: { job: FLAG_OVERDUE_JOB },
        });
      }
      throw error;
    }
  },
};
