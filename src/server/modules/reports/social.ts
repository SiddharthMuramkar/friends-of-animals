import { and, asc, eq, lte } from "drizzle-orm";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { socialSnapshot } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { BOM, formatCsv } from "../registration/domain/csv";
import { resolvePeriod, type ObjectivePeriodInput } from "./domain/period";
import {
  SOCIAL_METRICS,
  socialSnapshotInput,
  type SocialSnapshotInput,
  type SocialSnapshot,
} from "./domain/social-snapshot";

/** One channel/day is one observation. Replaying an identical submission
 * is a no-op; explicit corrections serialize on the unique row. Only the
 * audit record holds actor identity; metric observations are non-personal. */
export async function recordSocialSnapshot(
  ctx: UseCaseContext,
  input: SocialSnapshotInput
) {
  return ctx.db.transaction(async (db) => {
    const { role } = await authorize({ ...ctx, db }, "reports.social.record");
    const now = ctx.clock.now();
    const parsed = socialSnapshotInput(now).safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    const data = parsed.data;
    const [inserted] = await db
      .insert(socialSnapshot)
      .values({
        id: uuidv7(now),
        ...data,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [socialSnapshot.channel, socialSnapshot.recordedFor],
      })
      .returning({ id: socialSnapshot.id });
    if (inserted) {
      await recordAudit(db, ctx, {
        action: "social_snapshot.recorded",
        entity: { type: "social_snapshot", id: inserted.id },
        before: null,
        after: { fields: [...SOCIAL_METRICS] },
        actorRole: role,
      });
      return { ok: true, outcome: "recorded" } as const;
    }
    const [existing] = await db
      .select()
      .from(socialSnapshot)
      .where(
        and(
          eq(socialSnapshot.channel, data.channel),
          eq(socialSnapshot.recordedFor, data.recordedFor)
        )
      )
      .for("update");
    if (!existing) throw Error("Conflicting snapshot disappeared");
    const fields = SOCIAL_METRICS.filter(
      (field) => existing[field] !== data[field]
    );
    if (!fields.length) return { ok: true, outcome: "unchanged" } as const;
    await db
      .update(socialSnapshot)
      .set({ ...data, updatedAt: now })
      .where(eq(socialSnapshot.id, existing.id));
    await recordAudit(db, ctx, {
      action: "social_snapshot.corrected",
      entity: { type: "social_snapshot", id: existing.id },
      before: null,
      after: { fields },
      actorRole: role,
    });
    return { ok: true, outcome: "corrected" } as const;
  });
}

export async function readSocialTrend(
  db: AppDb,
  period: ObjectivePeriodInput
): Promise<SocialSnapshot[]> {
  // A day without a recorded snapshot is absent, never treated as zero.
  // Last known observation before a selected period can supply the baseline.
  // Reach/impressions/engagements are exactly the reported platform counts,
  // never summed across overlapping audiences or measurement windows.
  const rows = await db
    .select({
      channel: socialSnapshot.channel,
      recordedFor: socialSnapshot.recordedFor,
      followers: socialSnapshot.followers,
      posts: socialSnapshot.posts,
      reach: socialSnapshot.reach,
      impressions: socialSnapshot.impressions,
      engagements: socialSnapshot.engagements,
    })
    .from(socialSnapshot)
    .where(lte(socialSnapshot.recordedFor, period.to))
    .orderBy(asc(socialSnapshot.channel), asc(socialSnapshot.recordedFor));
  const previous = new Map<SocialSnapshotInput["channel"], number>();
  return rows.flatMap((row) => {
    const prior = previous.get(row.channel);
    previous.set(row.channel, row.followers);
    return row.recordedFor < period.from
      ? []
      : [
          {
            ...row,
            followerChange: prior === undefined ? null : row.followers - prior,
          },
        ];
  });
}

export function socialCsvRows(rows: SocialSnapshot[]) {
  return [
    [
      "channel",
      "recorded_for_ist",
      "followers",
      "follower_change",
      "posts",
      "reach",
      "impressions",
      "engagements",
    ],
    ...rows.map((row) => [
      row.channel,
      row.recordedFor,
      String(row.followers),
      String(row.followerChange ?? ""),
      String(row.posts),
      String(row.reach ?? ""),
      String(row.impressions ?? ""),
      String(row.engagements ?? ""),
    ]),
  ];
}

export async function getSocialReport(
  ctx: UseCaseContext,
  input: ObjectivePeriodInput
) {
  return ctx.db.transaction(
    async (db) => {
      await authorize({ ...ctx, db }, "reports.social.read");
      const resolved = resolvePeriod(input);
      if (!resolved.ok) return resolved;
      const period = { from: resolved.period.from, to: resolved.period.to };
      return {
        ok: true,
        report: { period, snapshots: await readSocialTrend(db, period) },
      } as const;
    },
    { isolationLevel: "repeatable read" }
  );
}

export async function exportSocialReportCsv(
  ctx: UseCaseContext,
  input: ObjectivePeriodInput
) {
  return ctx.db.transaction(
    async (db) => {
      const { role } = await authorize({ ...ctx, db }, "reports.social.export");
      const resolved = resolvePeriod(input);
      if (!resolved.ok) return resolved;
      const period = { from: resolved.period.from, to: resolved.period.to };
      const rows = await readSocialTrend(db, period);
      await recordAudit(db, ctx, {
        action: "reports.exported",
        entity: { type: "objective_report", id: "social" },
        before: null,
        after: { report: "social", format: "csv", ...period },
        actorRole: role,
      });
      return {
        ok: true,
        filename: `foa-social-${period.from}-${period.to}.csv`,
        csv:
          BOM +
          formatCsv([
            ["from_ist", "to_ist"],
            [period.from, period.to],
            ...socialCsvRows(rows),
          ]),
      } as const;
    },
    { isolationLevel: "repeatable read" }
  );
}
