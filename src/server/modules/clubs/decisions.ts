import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { emit } from "../../outbox";
import { recordAudit } from "../../audit/record";
import { club, clubDecision, clubMembership } from "../../db/schema";
import { DomainError } from "../../errors";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { readSetting } from "../settings/read";
import { affiliationFor } from "./affiliations";
import { decideClubStatus, type ClubAction } from "./domain/status";
import {
  activeMembership,
  clubIdSchema,
  endMembership,
  insertMembership,
} from "./membership";
import { lockedClub, refused, userId } from "./shared";

export const CLUB_REASON_PURPOSE = "club_decision.reason";
const schema = clubIdSchema.extend({ reason: z.string().optional() });
export type ClubDecisionInput = z.input<typeof schema>;
export async function changeClubStatus(
  ctx: UseCaseContext,
  action: ClubAction,
  input: ClubDecisionInput
) {
  const staff = action !== "withdraw";
  if (staff) await authorize(ctx, "club.decide");
  const actorId = userId(ctx);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const locked = await lockedClub(tx, parsed.data.clubId);
    if (!locked) throw new DomainError("forbidden", "Club not found");
    const { row, school } = locked;
    const { role } = await authorize(
      { ...ctx, db: tx },
      staff ? "club.decide" : "club.withdraw",
      row.applicantUserId ? { ownerId: row.applicantUserId } : {}
    );
    if (action === "approve") {
      if (!(await readSetting(tx, "clubs.enabled")))
        return refused("clubs_closed");
      if (school.status !== "verified")
        return refused("institution_not_verified");
      if (!row.applicantUserId && row.status === "applied")
        return refused("applicant_missing");
    }
    const [occupied] = await tx
      .select({ n: count() })
      .from(club)
      .where(
        and(
          eq(club.institutionId, row.institutionId),
          inArray(club.status, ["approved", "suspended"])
        )
      );
    const change = decideClubStatus({
      from: row.status,
      action,
      reason: parsed.data.reason ?? "",
      slotsHeld: occupied!.n,
      maxPerInstitution: await readSetting(tx, "clubs.maxPerInstitution", {
        lock: "share",
      }),
    });
    if (!change.ok) return change;
    const now = ctx.clock.now();
    const decisionId = uuidv7(now);
    await tx
      .update(club)
      .set({ status: change.to, updatedAt: now })
      .where(eq(club.id, row.id));
    await tx.insert(clubDecision).values({
      id: decisionId,
      clubId: row.id,
      decidedByUserId: actorId,
      fromStatus: row.status,
      toStatus: change.to,
      reasonCiphertext: change.reason
        ? ctx.cipher.encrypt(CLUB_REASON_PURPOSE, change.reason)
        : null,
      decidedAt: now,
    });
    await recordAudit(tx, ctx, {
      action: `club.${change.outcome}`,
      entity: { type: "club", id: row.id },
      before: { status: row.status },
      after: { status: change.to, decisionId },
      actorRole: role,
    });
    if (staff)
      await emit(tx, ctx.clock, {
        type: "club.decision_recorded",
        aggregate: { type: "club_decision", id: decisionId },
        payload: { decisionId },
      });
    if (change.outcome === "approved" && row.applicantUserId) {
      const affiliation = await affiliationFor(
        tx,
        ctx,
        row.applicantUserId,
        row.institutionId,
        row.applicantVerified ? undefined : row.applicantKind
      );
      if (
        affiliation &&
        !(await activeMembership(tx, row.id, row.applicantUserId))
      )
        await insertMembership(
          tx,
          ctx,
          row.id,
          row.applicantUserId,
          affiliation,
          role
        );
    }
    if (change.to === "closed") {
      const members = await tx
        .select()
        .from(clubMembership)
        .where(
          and(eq(clubMembership.clubId, row.id), isNull(clubMembership.leftAt))
        )
        .orderBy(clubMembership.userId);
      for (const member of members) await endMembership(tx, ctx, member, role);
    }
    return { ok: true as const, status: change.to, clubId: row.id };
  });
}
