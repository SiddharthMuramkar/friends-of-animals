// FOA staff decide about an institution (#73): verify, reject or suspend
// it, always with a reason. The status table (./domain/status.ts) says
// which moves exist. The first verification gives the Institution ID and
// makes the authorised person the institution's admin; verifying a
// suspended institution reinstates it with the ID it had. Each decision
// writes one audit entry, in the transaction that makes it.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { INSTITUTION_CODE, withUniqueCode } from "../codes/codes";
import type { AppDb } from "../../db/app-db";
import {
  institution,
  INSTITUTION_CODE_UNIQUE,
  userRole,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import {
  decideInstitutionStatus,
  INSTITUTION_DECISIONS,
  type InstitutionDecision,
  type InstitutionOutcome,
  type InstitutionStatus,
} from "./domain/status";

export type DecideInstitutionInput = {
  institutionId: string;
  decision: InstitutionDecision;
  reason: string;
};

export type DecideInstitutionResult =
  | {
      ok: true;
      outcome: InstitutionOutcome;
      status: InstitutionStatus;
      institutionCode: string | null;
    }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | "transition_not_allowed"
        | "reason_required"
        | "reason_too_long";
    };

const decideInstitutionInput = z.object({
  institutionId: z.uuid(),
  decision: z.enum(INSTITUTION_DECISIONS),
  // The status table checks the trimmed length; this only bounds the input.
  reason: z.string().max(10_000),
});

/** Makes `userId` the admin of the institution, unless they are already. */
async function grantInstitutionAdmin(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "clock" | "actor">,
  userId: string,
  institutionId: string
): Promise<void> {
  const now = ctx.clock.now();
  await tx
    .insert(userRole)
    .values({
      id: uuidv7(now),
      userId,
      role: "institution_admin",
      scopeType: "institution",
      scopeId: institutionId,
      grantedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      grantedAt: now,
    })
    .onConflictDoNothing();
}

export async function decideInstitution(
  ctx: UseCaseContext,
  input: DecideInstitutionInput
): Promise<DecideInstitutionResult> {
  const { role: actorRole } = await authorize(ctx, "institution.decide");
  const parsed = decideInstitutionInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, decision, reason } = parsed.data;
  const actorUserId = ctx.actor.kind === "user" ? ctx.actor.userId : null;

  return ctx.db.transaction(async (tx) => {
    // Locked, so two staff deciding at once queue and the second sees the
    // first's status.
    const [row] = await tx
      .select({
        status: institution.status,
        statusReason: institution.statusReason,
        institutionCode: institution.institutionCode,
        createdBy: institution.createdBy,
      })
      .from(institution)
      .where(eq(institution.id, institutionId))
      .for("update");
    if (!row) return { ok: false, error: "not_found" } as const;

    const change = decideInstitutionStatus({
      from: row.status,
      decision,
      reason,
    });
    if (!change.ok) return change;
    const now = ctx.clock.now();
    const byId = eq(institution.id, institutionId);
    const decided = {
      status: change.to,
      statusReason: change.reason,
      updatedAt: now,
    };

    let institutionCode = row.institutionCode;
    if (change.issuesInstitutionCode) {
      // A taken code aborts its statement, so each try runs in a savepoint
      // and the transaction survives to try the next one.
      institutionCode = await withUniqueCode(
        { format: INSTITUTION_CODE, constraint: INSTITUTION_CODE_UNIQUE },
        (code) =>
          tx.transaction(async (savepoint) => {
            await savepoint
              .update(institution)
              .set({
                ...decided,
                institutionCode: code,
                verifiedBy: actorUserId,
                verifiedAt: now,
              })
              .where(byId);
            return code;
          })
      );
      await grantInstitutionAdmin(tx, ctx, row.createdBy, institutionId);
    } else {
      await tx.update(institution).set(decided).where(byId);
    }

    await recordAudit(tx, ctx, {
      action: `institution.${change.outcome}`,
      entity: { type: "institution", id: institutionId },
      before: { status: row.status, reason: row.statusReason },
      after: change.issuesInstitutionCode
        ? {
            status: change.to,
            reason: change.reason,
            institutionCode,
            institutionAdmin: row.createdBy,
          }
        : { status: change.to, reason: change.reason },
      actorRole,
    });
    return {
      ok: true,
      outcome: change.outcome,
      status: change.to,
      institutionCode,
    } as const;
  });
}
