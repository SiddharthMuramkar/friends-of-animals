// The retention sweep (#114): one engine over the policy registry
// (./policies). For each swept policy it reads the period (the policy's
// setting, or the module's own date), takes the rows past it in batches,
// skips any whose subject is under a legal hold or still inside a
// statutory floor, and deletes or anonymises the rest. Each run, and each
// preview, writes one audit row with counts per policy and nothing else.
//
//   runRetentionSweep()     → the worker's daily run (system only)
//   previewRetentionSweep() → what a run would do now (super admin; dry run)
//
// Until a super admin turns on `retention.enforce`, a run only counts: a
// dry run, still audited, so FOA sees what would go before anything does.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq, lt, type SQL } from "drizzle-orm";

import { authorize } from "../../access/can";
import type { Action } from "../../access/policies";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { retentionRunProgress } from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { UseCaseContext } from "../../use-cases";
import {
  RETENTION_PERIODS,
  retentionSettingKey,
  type RetentionPeriod,
} from "./domain/periods";
import {
  planRetention,
  retentionRunSummary,
  type PolicyCounts,
  type RetentionRunSummary,
} from "./domain/retention-plan";
import { activeLegalHolds, lockRetentionHolds } from "./holds";
import { SWEPT_POLICIES, type RetentionPolicy } from "./policies";
import type { CandidateCursor } from "./policies/types";

/** What the sweep uses, including the Files storage port. */
export type SweepContext = Pick<
  UseCaseContext,
  "db" | "clock" | "settings" | "storage" | "cipher" | "blindIndex" | "actor"
>;

/** Rows a policy handles per transaction. */
export const SWEEP_BATCH = 500;
/** The scheduled job's existing expiry and the age for recovering its progress. */
export const SWEEP_EXPIRY_SECONDS = 2 * 60 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;

const ZERO: PolicyCounts = {
  deleted: 0,
  anonymised: 0,
  held: 0,
  retainedByFloor: 0,
};

type RetentionRun = RetentionRunSummary & { id: string };

function add(total: PolicyCounts, more: PolicyCounts): PolicyCounts {
  return {
    deleted: total.deleted + more.deleted,
    anonymised: total.anonymised + more.anonymised,
    held: total.held + more.held,
    retainedByFloor: total.retainedByFloor + more.retainedByFloor,
  };
}

/** The effective period and floor, read before opening the batch. */
async function periodOf(ctx: SweepContext, policy: RetentionPolicy) {
  if (policy.period.kind === "fixed") return { days: 0, floor: undefined };
  if (policy.period.kind === "calendar") {
    return {
      days: 0,
      floor: undefined,
      months: await ctx.settings.get(policy.period.settingKey),
    };
  }
  const { key } = policy.period;
  const period: RetentionPeriod = RETENTION_PERIODS[key];
  return {
    days: await ctx.settings.get(retentionSettingKey(key)),
    floor: period.floor,
  };
}

async function checkpointPolicy(
  ctx: SweepContext,
  tx: AppDb,
  run: RetentionRun,
  key: string,
  counts: PolicyCounts
) {
  const [checkpoint] = await tx
    .update(retentionRunProgress)
    .set({
      updatedAt: ctx.clock.now(),
      policies: { ...run.policies, [key]: counts },
    })
    .where(eq(retentionRunProgress.id, run.id))
    .returning({ id: retentionRunProgress.id });
  if (!checkpoint) throw new Error("Retention run already finalised");
}

/** Each object's row and count commit together, independent of the next object. */
async function finishDeletions(
  ctx: SweepContext,
  run: RetentionRun,
  key: string,
  ids: readonly string[],
  finishDeletion: NonNullable<RetentionPolicy["finishDeletion"]>
) {
  for (const id of ids) {
    run.policies[key] = await ctx.db.transaction(async (tx) => {
      await lockRetentionHolds(tx);
      const [checkpoint] = await tx
        .select({ id: retentionRunProgress.id })
        .from(retentionRunProgress)
        .where(eq(retentionRunProgress.id, run.id))
        .for("update");
      // A later run can finalise a stale checkpoint. Check before storage I/O.
      if (!checkpoint) throw new Error("Retention run already finalised");
      const counts = run.policies[key] ?? ZERO;
      const result = await finishDeletion(tx, id, ctx.storage);
      if (result === "skipped") return counts;
      const updated = { ...counts, [result]: counts[result] + 1 };
      await checkpointPolicy(ctx, tx, run, key, updated);
      return updated;
    });
  }
}

/** A batch applies its plan or stages object purges under the legal-hold lock. */
async function sweepPolicy(
  ctx: SweepContext,
  policy: RetentionPolicy,
  now: Date,
  run: RetentionRun
): Promise<void> {
  const { days, floor, months } = await periodOf(ctx, policy);
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const finishDeletion = policy.finishDeletion;
  let after: CandidateCursor | null = null;
  for (;;) {
    const batch: {
      next: CandidateCursor | null;
      counts: PolicyCounts;
      pending: string[];
    } = await ctx.db.transaction(async (tx: AppDb) => {
      await lockRetentionHolds(tx);
      const { candidates, next } = await policy.candidates(tx, {
        now,
        cutoff,
        months,
        after,
        limit: SWEEP_BATCH,
        blindIndex: ctx.blindIndex,
        cipher: ctx.cipher,
      });
      const plan = planRetention({
        now,
        policy: { key: policy.key, action: policy.action, days, floor },
        candidates,
        holds: await activeLegalHolds(tx),
      });
      const staging = !run.dryRun && finishDeletion !== undefined;
      const counts = add(
        run.policies[policy.key] ?? ZERO,
        staging ? { ...plan.counts, deleted: 0 } : plan.counts
      );
      if (!run.dryRun) {
        await checkpointPolicy(ctx, tx, run, policy.key, counts);
        await policy.apply(tx, plan.apply, candidates);
      }
      return { next, counts, pending: staging ? plan.apply : [] };
    });
    run.policies[policy.key] = batch.counts;
    if (finishDeletion) {
      await finishDeletions(
        ctx,
        run,
        policy.key,
        batch.pending,
        finishDeletion
      );
    }
    if (batch.next === null) return;
    after = batch.next;
  }
}

/** A checkpoint either exists or has exactly one immutable audit row. */
async function auditProgress(ctx: SweepContext, finished: SQL): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const runs = await tx
      .delete(retentionRunProgress)
      .where(finished)
      .returning();
    for (const { id, actorProcess, policies } of runs) {
      await recordAudit(
        tx,
        { clock: ctx.clock, actor: { kind: "system", process: actorProcess } },
        {
          action: "privacy.retention_run",
          entity: { type: "retention_run", id },
          before: null,
          after: retentionRunSummary({ dryRun: false, policies }),
          actorRole: null,
        }
      );
    }
  });
}

/** Every policy in order, auditing committed counts even if a later batch fails. */
async function sweep(
  ctx: SweepContext,
  action: Action,
  dryRunAsked: boolean
): Promise<RetentionRunSummary> {
  const { role: actorRole } = await authorize(ctx, action);
  const dryRun = dryRunAsked || !(await ctx.settings.get("retention.enforce"));
  const now = ctx.clock.now();
  const run: RetentionRun = { id: uuidv7(now), dryRun, policies: {} };
  if (ctx.actor.kind === "system") {
    // A crash or an unavailable database can prevent the previous attempt
    // from finalising. Recover it once it has stopped making progress.
    const staleBefore = new Date(now.getTime() - SWEEP_EXPIRY_SECONDS * 1000);
    await auditProgress(ctx, lt(retentionRunProgress.updatedAt, staleBefore));
    if (!dryRun) {
      await ctx.db.insert(retentionRunProgress).values({
        id: run.id,
        actorProcess: ctx.actor.process,
        updatedAt: now,
        policies: {},
      });
    }
  }
  try {
    for (const policy of SWEPT_POLICIES)
      await sweepPolicy(ctx, policy, now, run);
  } finally {
    if (dryRun) {
      await recordAudit(
        ctx.db,
        ctx,
        {
          action: "privacy.retention_run",
          entity: { type: "retention_run", id: run.id },
          before: null,
          after: retentionRunSummary(run),
          actorRole,
        },
        { withoutRequestMeta: true }
      );
    } else {
      await auditProgress(ctx, eq(retentionRunProgress.id, run.id));
    }
  }
  return retentionRunSummary(run);
}

/**
 * Deletes and anonymises every record past its retention, unless a legal
 * hold or a statutory floor keeps it; only counts while retention is off.
 * The worker's daily schedule runs it (system only).
 */
export function runRetentionSweep(
  ctx: SweepContext
): Promise<RetentionRunSummary> {
  return sweep(ctx, "privacy.sweep.run", false);
}

/** What a run would delete, anonymise and keep now; changes nothing. */
export function previewRetentionSweep(
  ctx: SweepContext
): Promise<RetentionRunSummary> {
  return sweep(ctx, "privacy.sweep.preview", true);
}
