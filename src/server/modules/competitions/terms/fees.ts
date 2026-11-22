// Setting a competition's fees (#72).
//
//   setCompetitionFees({ competitionId, fees: { individual: "1,500" }, currency: "INR" })
//   setCompetitionFees({ competitionId, free: true })
//     → a competition manager, globally or for this competition, with a
//       fresh second factor (money)
//
// Fees lock once registration opens: people have paid the stored amounts.
// Loads under plain Node: relative imports only.

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { competitionFee } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import {
  decideFees,
  feeChanges,
  feeEditAllowed,
  FEE_CURRENCY,
  PARTICIPATION_ROUTES,
  type FeeInput,
  type FeeProblem,
  type ParticipationRoute,
} from "../domain/fees";
import { competitionResource } from "./policy";
import { lockCompetition, storedFees } from "./repository";

export type TermsContext = Pick<UseCaseContext, "db" | "clock" | "actor">;

export type SetCompetitionFeesInput = { competitionId: string } & FeeInput;

export type SetCompetitionFeesResult =
  | { ok: true; changed: boolean }
  | InvalidInput
  | {
      ok: false;
      error: "not_found" | "fees_locked" | "participation_not_set";
    }
  | { ok: false; error: "invalid_fees"; problems: FeeProblem[] };

const setFeesInput = z.union([
  z.object({ competitionId: z.uuid(), free: z.literal(true) }),
  z.object({
    competitionId: z.uuid(),
    fees: z.partialRecord(z.enum(PARTICIPATION_ROUTES), z.string().max(40)),
    currency: z.string().max(8),
  }),
]);

/**
 * Sets the fee of every route the competition offers, or makes them all
 * free. Amounts that don't change are a no-op (`changed: false`) and
 * record nothing; a stored fee for a route it no longer offers goes.
 */
export async function setCompetitionFees(
  ctx: TermsContext,
  input: SetCompetitionFeesInput
): Promise<SetCompetitionFeesResult> {
  const resource = competitionResource(input.competitionId);
  const { role } = await authorize(ctx, "competition.set_fees", resource);
  const valid = setFeesInput.safeParse(input);
  if (!valid.success) return invalidInput(valid.error);
  const { competitionId, ...fees } = valid.data;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const found = await lockCompetition(tx, competitionId);
    if (!found) return { ok: false, error: "not_found" } as const;
    if (!feeEditAllowed(found.status)) {
      return { ok: false, error: "fees_locked" } as const;
    }
    if (found.participation === null) {
      return { ok: false, error: "participation_not_set" } as const;
    }
    const decided = decideFees(found.participation, fees);
    if (!decided.ok) {
      return {
        ok: false,
        error: "invalid_fees",
        problems: decided.problems,
      } as const;
    }
    const change = feeChanges(
      await storedFees(tx, competitionId),
      decided.fees
    );
    if (!change) return { ok: true, changed: false } as const;

    const updatedByUserId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    const set = Object.entries(decided.fees).map(([route, amount]) => ({
      competitionId,
      route: route as ParticipationRoute,
      amountMinor: amount,
      currency: FEE_CURRENCY,
      updatedByUserId,
      updatedAt: now,
    }));
    const removed = PARTICIPATION_ROUTES.filter(
      (route) => change.after[route] === null
    );
    if (removed.length > 0) {
      await tx
        .delete(competitionFee)
        .where(
          and(
            eq(competitionFee.competitionId, competitionId),
            inArray(competitionFee.route, removed)
          )
        );
    }
    const changedRoutes = set.filter(
      ({ route }) => change.after[route] !== undefined
    );
    if (changedRoutes.length > 0) {
      await tx
        .insert(competitionFee)
        .values(changedRoutes)
        .onConflictDoUpdate({
          target: [competitionFee.competitionId, competitionFee.route],
          set: {
            amountMinor: sql`excluded.amount_minor`,
            currency: sql`excluded.currency`,
            updatedByUserId: sql`excluded.updated_by_user_id`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    await recordAudit(tx, ctx, {
      action: "competition.fees_set",
      entity: { type: "competition", id: competitionId },
      before: { fees: change.before },
      after: { fees: change.after },
      actorRole: role,
    });
    return { ok: true, changed: true } as const;
  });
}
