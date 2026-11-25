// Trusted write seam. Call from the transaction that records the fact, not
// from browser actions. No untrusted labels or private free text.
import { and, eq, isNull } from "drizzle-orm";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { engagementMilestone, timelineEntry } from "../../db/schema";
import { monotonicUuidv7, uuidv7 } from "../../ids";
import type { UseCaseContext } from "../../use-cases";
import {
  milestoneIdentity,
  milestoneSourceKey,
  type MilestoneKind,
} from "./domain/milestones";
import type { Subject } from "./domain/subject";
import {
  isTimelineEntryKind,
  timelineKindForMilestone,
  type TimelineEntryKind,
} from "./domain/timeline";
import {
  belongsTo,
  lockPerson,
  subjectColumns,
  subjectKeys,
  subjectOf,
} from "./subjects";

export type EngagementFact =
  | {
      type: "milestone";
      subject: Subject;
      kind: MilestoneKind;
      competitionId: string | null;
      occurredAt: Date;
      sourceType: string;
      sourceId: string;
    }
  | {
      type: "entry";
      subject: Subject;
      kind: TimelineEntryKind;
      occurredAt: Date;
      sourceKey: string;
      refType: string;
      refId: string;
    };

const nextTimelineId = monotonicUuidv7();

export async function recordEngagement(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "clock" | "actor">,
  fact: EngagementFact
): Promise<void> {
  const now = ctx.clock.now();
  if (fact.type === "entry") {
    if (!isTimelineEntryKind(fact.kind) || fact.kind.startsWith("milestone.")) {
      throw new Error("Invalid plain timeline kind");
    }
    const subject = await lockPerson(tx, fact.subject);
    const keys = await subjectKeys(tx, subject);
    const [found] = await tx
      .select({ id: timelineEntry.id })
      .from(timelineEntry)
      .where(
        and(
          belongsTo(keys, timelineEntry),
          eq(timelineEntry.sourceKey, fact.sourceKey)
        )
      )
      .limit(1);
    if (found) return;
    await tx
      .insert(timelineEntry)
      .values({
        id: nextTimelineId(now),
        ...subjectColumns(subject),
        kind: fact.kind,
        occurredAt: fact.occurredAt,
        refType: fact.refType,
        refId: fact.refId,
        sourceKey: fact.sourceKey,
        createdAt: now,
      })
      .onConflictDoNothing();
    return;
  }
  milestoneIdentity(fact);
  // A competition fact always stays on its actual participant profile.
  // A lifetime fact converges on a prior milestone (possibly predating login).
  const subject =
    fact.competitionId === null
      ? await lockPerson(tx, fact.subject)
      : fact.subject;
  const keys =
    fact.competitionId === null ? await subjectKeys(tx, subject) : [subject];
  const matching = and(
    belongsTo(keys, engagementMilestone),
    eq(engagementMilestone.kind, fact.kind),
    fact.competitionId === null
      ? isNull(engagementMilestone.competitionId)
      : eq(engagementMilestone.competitionId, fact.competitionId)
  );
  let [milestone] = await tx
    .select()
    .from(engagementMilestone)
    .where(matching)
    .limit(1);
  if (!milestone) {
    [milestone] = await tx
      .insert(engagementMilestone)
      .values({
        id: uuidv7(now),
        ...subjectColumns(subject),
        kind: fact.kind,
        competitionId: fact.competitionId,
        achievedAt: fact.occurredAt,
        sourceType: fact.sourceType,
        sourceId: fact.sourceId,
      })
      .onConflictDoNothing()
      .returning();
    if (milestone) {
      await recordAudit(tx, ctx, {
        action: "engagement.milestone_recorded",
        entity: { type: "engagement_milestone", id: milestone.id },
        before: null,
        after: { kind: milestone.kind, competitionId: milestone.competitionId },
        actorRole: null,
      });
    } else {
      [milestone] = await tx
        .select()
        .from(engagementMilestone)
        .where(matching)
        .limit(1);
    }
  }
  if (!milestone) throw new Error("Milestone could not be recorded");
  const actualSubject = subjectOf(milestone);
  await tx
    .insert(timelineEntry)
    .values({
      id: nextTimelineId(now),
      ...subjectColumns(actualSubject),
      kind: timelineKindForMilestone(milestone.kind),
      occurredAt: milestone.achievedAt,
      milestoneId: milestone.id,
      refType: milestone.competitionId ? "competition" : milestone.sourceType,
      refId: milestone.competitionId ?? milestone.sourceId,
      sourceKey: milestoneSourceKey({
        subject: actualSubject,
        kind: milestone.kind,
        competitionId: milestone.competitionId,
      }),
      createdAt: now,
    })
    .onConflictDoNothing();
}
