import { and, asc, eq } from "drizzle-orm";
import {
  competition,
  club,
  event,
  engagementMilestone,
  timelineEntry,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import {
  groupTimelineByYear,
  isTimelineEntryKind,
  timelineCategory,
} from "./domain/timeline";
import { targetSubject, type TargetInput } from "./membership";
import { belongsTo, subjectKeys } from "./subjects";

export async function getTimeline(
  ctx: UseCaseContext,
  input: TargetInput = {}
) {
  const subject = await targetSubject(ctx, input);
  const keys = await subjectKeys(ctx.db, subject);
  const milestones = await ctx.db
    .select({
      id: engagementMilestone.id,
      kind: engagementMilestone.kind,
      competitionId: engagementMilestone.competitionId,
      achievedAt: engagementMilestone.achievedAt,
    })
    .from(engagementMilestone)
    .where(belongsTo(keys, engagementMilestone))
    .orderBy(asc(engagementMilestone.achievedAt), asc(engagementMilestone.id));
  const rows = await ctx.db
    .select({
      id: timelineEntry.id,
      kind: timelineEntry.kind,
      occurredAt: timelineEntry.occurredAt,
      competitionName: competition.name,
      eventTitle: event.title,
      clubName: club.name,
      refType: timelineEntry.refType,
      refId: timelineEntry.refId,
      competitionId: engagementMilestone.competitionId,
    })
    .from(timelineEntry)
    .leftJoin(
      engagementMilestone,
      eq(engagementMilestone.id, timelineEntry.milestoneId)
    )
    .leftJoin(
      competition,
      eq(competition.id, engagementMilestone.competitionId)
    )
    .leftJoin(
      event,
      and(eq(timelineEntry.refType, "event"), eq(timelineEntry.refId, event.id))
    )
    .leftJoin(
      club,
      and(eq(timelineEntry.refType, "club"), eq(timelineEntry.refId, club.id))
    )
    .where(belongsTo(keys, timelineEntry))
    .orderBy(asc(timelineEntry.occurredAt), asc(timelineEntry.id));
  const entries = rows.flatMap((row) =>
    isTimelineEntryKind(row.kind)
      ? [{ ...row, kind: row.kind, category: timelineCategory(row.kind) }]
      : []
  );
  return { milestones, entries, years: groupTimelineByYear(entries) };
}
