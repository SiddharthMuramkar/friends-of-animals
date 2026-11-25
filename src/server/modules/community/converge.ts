// A verified teen-login link proves two prior subject keys were the same
// person. The identity module holds both the account and profile locks
// throughout this transaction. Keep the earliest membership identity and
// milestone, preferring the person's own profile text when both are active.
import { asc, eq, or, and } from "drizzle-orm";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  communityMember,
  engagementMilestone,
  timelineEntry,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";

export async function convergeCommunityIdentity(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "actor" | "clock">,
  userId: string,
  profileId: string
): Promise<void> {
  const members = await tx
    .select()
    .from(communityMember)
    .where(
      or(
        eq(communityMember.subjectUserId, userId),
        eq(communityMember.subjectProfileId, profileId)
      )
    )
    .orderBy(asc(communityMember.joinedAt), asc(communityMember.id));
  const [keep, other] = members;
  if (keep && other) {
    const login = keep.subjectUserId ? keep : other;
    const profile = keep.subjectProfileId ? keep : other;
    // Active on either identity means active in the newly united journey.
    const active = login.status === "active" || profile.status === "active";
    const content =
      login.status === "active" || profile.status === "left" ? login : profile;
    const leftAt = active
      ? null
      : login.leftAt!.getTime() >= profile.leftAt!.getTime()
        ? login.leftAt
        : profile.leftAt;
    await tx
      .update(communityMember)
      .set({
        displayNameCiphertext: content.displayNameCiphertext,
        aboutCiphertext: content.aboutCiphertext,
        status: active ? "active" : "left",
        leftAt,
        updatedAt: ctx.clock.now(),
      })
      .where(eq(communityMember.id, keep.id));
    // The historic earliest join remains the member's identity.
    await tx
      .update(engagementMilestone)
      .set({ sourceId: keep.id })
      .where(
        and(
          eq(engagementMilestone.sourceType, "community_member"),
          eq(engagementMilestone.sourceId, other.id)
        )
      );
    await tx
      .update(timelineEntry)
      .set({ refId: keep.id })
      .where(
        and(
          eq(timelineEntry.refType, "community_member"),
          eq(timelineEntry.refId, other.id)
        )
      );
    await tx.delete(communityMember).where(eq(communityMember.id, other.id));
    await recordAudit(tx, ctx, {
      action: "community.identity_converged",
      entity: { type: "community_member", id: keep.id },
      before: { membershipIds: [keep.id, other.id] },
      after: { status: active ? "active" : "left" },
      actorRole: null,
    });
  }
  const milestones = await tx
    .select()
    .from(engagementMilestone)
    .where(
      or(
        eq(engagementMilestone.subjectUserId, userId),
        eq(engagementMilestone.subjectProfileId, profileId)
      )
    )
    .orderBy(asc(engagementMilestone.achievedAt), asc(engagementMilestone.id));
  const logical = new Set<string>();
  for (const milestone of milestones) {
    const key = JSON.stringify([milestone.kind, milestone.competitionId]);
    if (logical.has(key)) {
      // Cascades to the duplicate milestone's timeline entry.
      await tx
        .delete(engagementMilestone)
        .where(eq(engagementMilestone.id, milestone.id));
    }
    logical.add(key);
  }
  const entries = await tx
    .select({ id: timelineEntry.id, sourceKey: timelineEntry.sourceKey })
    .from(timelineEntry)
    .where(
      or(
        eq(timelineEntry.subjectUserId, userId),
        eq(timelineEntry.subjectProfileId, profileId)
      )
    )
    .orderBy(asc(timelineEntry.occurredAt), asc(timelineEntry.id));
  const sources = new Set<string>();
  for (const item of entries) {
    if (sources.has(item.sourceKey))
      await tx.delete(timelineEntry).where(eq(timelineEntry.id, item.id));
    sources.add(item.sourceKey);
  }
}
