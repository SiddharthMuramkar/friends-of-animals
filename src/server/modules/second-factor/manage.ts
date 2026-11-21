// Removing factors.
//
//   removeSecondFactor({ factorId })  → the user's own, after step-up
//   resetSecondFactors({ userId })    → a super admin, after step-up
//
// A reset is FOA's recovery for someone who lost every factor (HR-19): they
// prove who they are to a super admin outside the platform, the super
// admin clears their factors, and they enrol again. Loads under plain
// Node: relative imports only.

import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  secondFactor,
  secondFactorLockout,
  session,
  sessionSecondFactor,
  webauthnChallenge,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import {
  isEnrolled,
  lockFactorSession,
  lockUser,
  signedInUser,
} from "./session-factor";
import { dropPendingAuthenticators, type SecondFactorContext } from "./totp";

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
  await authorize(ctx, "second-factor.remove");
  const actor = signedInUser(ctx.actor);
  const parsed = removeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  return ctx.db.transaction(async (tx) => {
    await lockFactorSession(tx, actor, ctx.clock);
    const { role } = await authorize(
      { ...ctx, db: tx },
      "second-factor.remove"
    );
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
    const enrolled = await isEnrolled(tx, actor.userId);
    if (!enrolled) {
      // The stepped-up session can enrol a replacement. Other sessions
      // must sign in again. Their stamps and challenges cascade away.
      await tx
        .delete(session)
        .where(
          and(eq(session.userId, actor.userId), ne(session.id, actor.sessionId))
        );
      await tx
        .delete(sessionSecondFactor)
        .where(eq(sessionSecondFactor.sessionId, actor.sessionId));
      await tx
        .delete(webauthnChallenge)
        .where(eq(webauthnChallenge.sessionId, actor.sessionId));
      await dropPendingAuthenticators(tx, actor.userId);
    } else if (removed.confirmedAt) {
      // Other sessions may have passed with the removed factor.
      await tx
        .delete(sessionSecondFactor)
        .where(
          and(
            inArray(
              sessionSecondFactor.sessionId,
              sessionsOf(tx, actor.userId)
            ),
            ne(sessionSecondFactor.sessionId, actor.sessionId)
          )
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
 * Clears the user's factors and lockout and ends every session, including
 * its verification stamp and pending passkey challenges. The person who
 * requested recovery signs in again before enrolling a replacement.
 */
export async function resetSecondFactors(
  ctx: SecondFactorContext,
  input: { userId: string }
): Promise<ResetSecondFactorsResult> {
  await authorize(ctx, "second-factor.reset");
  const parsed = resetInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { userId } = parsed.data;

  return ctx.db.transaction(async (tx) => {
    const found = await lockUser(tx, userId);
    const { role } = await authorize({ ...ctx, db: tx }, "second-factor.reset");
    if (!found) return { ok: false, error: "not_found" } as const;

    const removed = await tx
      .delete(secondFactor)
      .where(eq(secondFactor.userId, userId))
      .returning({
        id: secondFactor.id,
        kind: secondFactor.kind,
        label: secondFactor.label,
        confirmedAt: secondFactor.confirmedAt,
      });
    await tx.delete(session).where(eq(session.userId, userId));
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
