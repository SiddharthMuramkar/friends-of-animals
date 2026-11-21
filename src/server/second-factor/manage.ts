// Removing factors.
//
//   removeSecondFactor({ factorId })  → the user's own, after step-up
//   resetSecondFactors({ userId })    → a super admin, after step-up
//
// A reset is FOA's recovery for someone who lost every factor (HR-19): they
// prove who they are to a super admin outside the platform, the super
// admin clears their factors, and they enrol again. Loads under plain
// Node: relative imports only.

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../access/can";
import { recordAudit } from "../audit/record";
import type { AppDb } from "../db/app-db";
import {
  secondFactor,
  secondFactorLockout,
  session,
  sessionSecondFactor,
  user,
} from "../db/schema";
import { invalidInput, type InvalidInput } from "../input";
import { isEnrolled, signedInUser } from "./session-factor";
import type { SecondFactorContext } from "./totp";

const removeInput = z.object({ factorId: z.uuid() });
const resetInput = z.object({ userId: z.uuid() });

export type RemoveSecondFactorResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: "not_found" };

/** Removes one of the signed-in user's factors. */
export async function removeSecondFactor(
  ctx: SecondFactorContext,
  input: { factorId: string }
): Promise<RemoveSecondFactorResult> {
  const { role } = await authorize(ctx, "second-factor.remove");
  const actor = signedInUser(ctx.actor);
  const parsed = removeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  return ctx.db.transaction(async (tx) => {
    // Only the user's own factors match, so another's is "not found".
    const [removed] = await tx
      .delete(secondFactor)
      .where(
        and(
          eq(secondFactor.id, parsed.data.factorId),
          eq(secondFactor.userId, actor.userId)
        )
      )
      .returning({
        id: secondFactor.id,
        kind: secondFactor.kind,
        label: secondFactor.label,
        confirmedAt: secondFactor.confirmedAt,
      });
    if (!removed) return { ok: false, error: "not_found" } as const;
    // With no factor left, no session counts as having passed one, so a
    // factor added later can't revive an old session's second factor.
    if (!(await isEnrolled(tx, actor.userId))) {
      await tx
        .delete(sessionSecondFactor)
        .where(
          inArray(sessionSecondFactor.sessionId, sessionsOf(tx, actor.userId))
        );
    }
    if (removed.confirmedAt) {
      await recordAudit(tx, ctx, {
        action: "second_factor.removed",
        entity: { type: "user", id: actor.userId },
        before: {
          factorId: removed.id,
          kind: removed.kind,
          label: removed.label,
        },
        after: null,
        actorRole: role,
      });
    }
    return { ok: true } as const;
  });
}

export type ResetSecondFactorsResult =
  | { ok: true; removed: number }
  | InvalidInput
  | { ok: false; error: "not_found" };

/** The user's session ids. */
function sessionsOf(tx: AppDb, userId: string) {
  return tx
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId));
}

/**
 * Clears every factor a user holds, every second factor their sessions
 * passed and any lockout, so they can enrol again.
 */
export async function resetSecondFactors(
  ctx: SecondFactorContext,
  input: { userId: string }
): Promise<ResetSecondFactorsResult> {
  const { role } = await authorize(ctx, "second-factor.reset");
  const parsed = resetInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { userId } = parsed.data;

  return ctx.db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("no key update");
    if (!account) return { ok: false, error: "not_found" } as const;

    const removed = await tx
      .delete(secondFactor)
      .where(eq(secondFactor.userId, userId))
      .returning({
        id: secondFactor.id,
        kind: secondFactor.kind,
        label: secondFactor.label,
        confirmedAt: secondFactor.confirmedAt,
      });
    await tx
      .delete(sessionSecondFactor)
      .where(inArray(sessionSecondFactor.sessionId, sessionsOf(tx, userId)));
    await tx
      .delete(secondFactorLockout)
      .where(eq(secondFactorLockout.userId, userId));

    const confirmed = removed
      .filter((factor) => factor.confirmedAt !== null)
      .sort((a, b) => a.id.localeCompare(b.id));
    await recordAudit(tx, ctx, {
      action: "second_factor.reset",
      entity: { type: "user", id: userId },
      before: {
        factors: confirmed.map((factor) => ({
          factorId: factor.id,
          kind: factor.kind,
          label: factor.label,
        })),
      },
      after: null,
      actorRole: role,
    });
    return { ok: true, removed: confirmed.length } as const;
  });
}
