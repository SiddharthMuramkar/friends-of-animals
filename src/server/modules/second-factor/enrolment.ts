// What adding any second factor shares: who may start or finish
// enrolling, the factor's label, and clearing unconfirmed authenticator
// apps. TOTP, passkeys and factor removal all use it.
//
// Loads under plain Node: relative imports only.

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../../db/app-db";
import { secondFactor } from "../../db/schema";
import { DomainError } from "../../errors";
import type { UseCaseContext } from "../../use-cases";
import { secondFactorRefusal } from "./requirement";
import {
  isEnrolled,
  lockFactorSession,
  type SignedInUser,
} from "./session-factor";

export type SecondFactorContext = Pick<
  UseCaseContext,
  "db" | "clock" | "actor" | "auth" | "cipher"
>;

/** The name a user gives a factor, shown in their list. */
export const factorLabel = z.string().trim().min(1).max(60);

/**
 * Check the live session and any step-up requirement under the same lock
 * as removal and reset. Both starting and finishing enrolment use it.
 */
export async function authorizeEnrolment(
  tx: AppDb,
  ctx: SecondFactorContext,
  actor: SignedInUser
): Promise<void> {
  await lockFactorSession(tx, actor, ctx.clock);
  if (!(await isEnrolled(tx, actor.userId))) return;
  const refusal = await secondFactorRefusal(
    { db: tx, clock: ctx.clock },
    actor,
    "step-up",
    []
  );
  if (refusal) {
    throw new DomainError(refusal, "Adding a factor needs a fresh one");
  }
}

/**
 * Drops the user's authenticator apps still waiting for their first code.
 * Starting again drops them, and so does confirming any factor: from then
 * on, adding one needs step-up, so none is left over to confirm later.
 */
export async function dropPendingAuthenticators(
  tx: AppDb,
  userId: string
): Promise<void> {
  await tx
    .delete(secondFactor)
    .where(
      and(
        eq(secondFactor.userId, userId),
        eq(secondFactor.kind, "totp"),
        isNull(secondFactor.confirmedAt)
      )
    );
}
