import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { clubMembership, type ClubMembership } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { recordEngagement } from "../community";
import { readSetting } from "../settings/read";
import { affiliationFor } from "./affiliations";
import { decideJoin, type ClubRole } from "./domain/membership";
import { lockedClub, refused, userId } from "./shared";

export const clubIdSchema = z.strictObject({ clubId: z.uuid() });
const joinSchema = clubIdSchema.extend({
  kind: z.enum(["student", "teacher"]).optional(),
});
export type ClubIdInput = z.input<typeof clubIdSchema>;
export type ClubJoinInput = z.input<typeof joinSchema>;
export async function activeMembership(
  tx: AppDb,
  clubId: string,
  memberId: string
) {
  const [row] = await tx
    .select()
    .from(clubMembership)
    .where(
      and(
        eq(clubMembership.clubId, clubId),
        eq(clubMembership.userId, memberId),
        isNull(clubMembership.leftAt)
      )
    );
  return row;
}
export async function membershipFact(
  tx: AppDb,
  ctx: UseCaseContext,
  membership: ClubMembership,
  kind: "joined" | "left",
  actorRole: Role | null
) {
  await recordEngagement(tx, ctx, {
    type: "entry",
    subject: { kind: "user", userId: membership.userId },
    kind: kind === "joined" ? "club.joined" : "club.left",
    occurredAt: ctx.clock.now(),
    sourceKey: `club_membership:${membership.id}:${kind}`,
    refType: "club",
    refId: membership.clubId,
  });
  await recordAudit(tx, ctx, {
    action: `club.member_${kind}`,
    entity: { type: "club", id: membership.clubId },
    before: null,
    after: { membershipId: membership.id },
    actorRole,
  });
}
export async function insertMembership(
  tx: AppDb,
  ctx: UseCaseContext,
  clubId: string,
  memberId: string,
  affiliation: { role: ClubRole; verified: boolean },
  actorRole: Role | null
) {
  const [row] = await tx
    .insert(clubMembership)
    .values({
      id: uuidv7(ctx.clock.now()),
      clubId,
      userId: memberId,
      role: affiliation.role,
      affiliationVerified: affiliation.verified,
      joinedAt: ctx.clock.now(),
    })
    .returning();
  await membershipFact(tx, ctx, row!, "joined", actorRole);
  return row!.id;
}
export async function endMembership(
  tx: AppDb,
  ctx: UseCaseContext,
  row: ClubMembership,
  actorRole: Role | null
) {
  await tx
    .update(clubMembership)
    .set({ leftAt: ctx.clock.now() })
    .where(eq(clubMembership.id, row.id));
  await membershipFact(tx, ctx, row, "left", actorRole);
}
export async function joinClub(ctx: UseCaseContext, input: ClubJoinInput) {
  const { role } = await authorize(ctx, "club.join");
  const memberId = userId(ctx);
  const parsed = joinSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    if (!(await readSetting(tx, "clubs.enabled")))
      return refused("clubs_closed");
    const locked = await lockedClub(tx, parsed.data.clubId);
    if (!locked || locked.school.status !== "verified")
      return refused("club_not_open");
    const { row } = locked;
    const affiliation = await affiliationFor(
      tx,
      ctx,
      memberId,
      row.institutionId,
      parsed.data.kind
    );
    const current = await activeMembership(tx, row.id, memberId);
    const decision = decideJoin({
      clubStatus: row.status,
      role: affiliation?.role ?? null,
      alreadyMember: Boolean(current),
    });
    if (!decision.ok) return decision;
    const membershipId = await insertMembership(
      tx,
      ctx,
      row.id,
      memberId,
      affiliation!,
      role
    );
    return { ok: true as const, membershipId };
  });
}
export async function leaveClub(ctx: UseCaseContext, input: ClubIdInput) {
  const { role } = await authorize(ctx, "club.leave");
  const memberId = userId(ctx);
  const parsed = clubIdSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const locked = await lockedClub(tx, parsed.data.clubId);
    if (!locked) return refused("not_member");
    const row = await activeMembership(tx, locked.row.id, memberId);
    if (!row) return refused("not_member");
    await endMembership(tx, ctx, row, role);
    return { ok: true as const, membershipId: row.id };
  });
}
