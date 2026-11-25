import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { club } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { readSetting } from "../settings/read";
import { clubNameSchema, decideClubApplication } from "./domain/application";
import { affiliationFor } from "./affiliations";
import { userId, refused, lockInstitution } from "./shared";
import {
  getClubApplicationOptions,
  listMyClubs,
  listClubsForReview,
  getClub,
  listClubMembers,
  getClubActivity,
} from "./queries";
import type { TargetInput } from "../community/membership";
import { changeClubStatus, type ClubDecisionInput } from "./decisions";
import {
  joinClub,
  leaveClub,
  type ClubJoinInput,
  type ClubIdInput,
} from "./membership";

const applicationSchema = z.strictObject({
  institutionId: z.uuid(),
  name: clubNameSchema,
  kind: z.enum(["student", "teacher"]).optional(),
});
export type ClubApplicationInput = z.input<typeof applicationSchema>;
export async function applyForClub(
  ctx: UseCaseContext,
  input: ClubApplicationInput
) {
  const { role } = await authorize(ctx, "club.apply");
  const applicantUserId = userId(ctx);
  const parsed = applicationSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    if (!(await readSetting(tx, "clubs.enabled")))
      return refused("clubs_closed");
    const { institutionId, name } = parsed.data;
    const school = await lockInstitution(tx, institutionId);
    if (school?.status !== "verified")
      return refused("institution_not_verified");
    const affiliation = await affiliationFor(
      tx,
      ctx,
      applicantUserId,
      institutionId,
      parsed.data.kind
    );
    const [existing] = await tx
      .select({ id: club.id })
      .from(club)
      .where(
        and(
          eq(club.applicantUserId, applicantUserId),
          eq(club.institutionId, institutionId),
          eq(club.status, "applied")
        )
      );
    const decision = decideClubApplication({
      institutionVerified: true,
      role: affiliation?.role ?? null,
      hasPendingApplication: Boolean(existing),
    });
    if (!decision.ok) return decision;
    const now = ctx.clock.now();
    const clubId = uuidv7(now);
    await tx.insert(club).values({
      id: clubId,
      institutionId,
      name,
      applicantUserId,
      applicantKind: decision.applicantKind,
      applicantVerified: affiliation!.verified,
      status: "applied",
      appliedAt: now,
      updatedAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "club.applied",
      entity: { type: "club", id: clubId },
      before: null,
      after: { status: "applied", institutionId },
      actorRole: role,
    });
    return { ok: true as const, clubId };
  });
}
export const clubsUseCases = (ctx: UseCaseContext) => ({
  applyForClub: (input: ClubApplicationInput) => applyForClub(ctx, input),
  approveClub: (input: ClubDecisionInput) =>
    changeClubStatus(ctx, "approve", input),
  declineClub: (input: ClubDecisionInput) =>
    changeClubStatus(ctx, "decline", input),
  suspendClub: (input: ClubDecisionInput) =>
    changeClubStatus(ctx, "suspend", input),
  closeClub: (input: ClubDecisionInput) =>
    changeClubStatus(ctx, "close", input),
  withdrawClubApplication: (input: ClubDecisionInput) =>
    changeClubStatus(ctx, "withdraw", input),
  joinClub: (input: ClubJoinInput) => joinClub(ctx, input),
  leaveClub: (input: ClubIdInput) => leaveClub(ctx, input),
  getClubApplicationOptions: () => getClubApplicationOptions(ctx),
  listMyClubs: (input: TargetInput = {}) => listMyClubs(ctx, input),
  listClubsForReview: () => listClubsForReview(ctx),
  getClub: (input: ClubIdInput) => getClub(ctx, input),
  listClubMembers: (input: ClubIdInput) => listClubMembers(ctx, input),
  getClubActivity: (input: ClubIdInput) => getClubActivity(ctx, input),
});
