// Setting a round's award scheme and prizes (#72).
//
//   setRoundAwards({ competitionId, roundKey: "school", scheme: "grades_ab",
//                    prizes: { grade_a: "Trophy" } })
//     → a competition manager, globally or for this competition
//
// One round at a time, so changing the school round leaves the FOA final
// alone. Stays editable after registration opens: prizes are copy.
// Loads under plain Node: relative imports only.

import { sql } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { competitionAwardScheme } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import {
  awardsChange,
  DEFAULT_AWARD_SCHEME,
  decideRoundAwards,
  type RoundAwardsError,
} from "../domain/award-schemes";
import type { TermsContext } from "./fees";
import { competitionResource } from "./policy";
import { lockCompetition, storedAwards } from "./repository";

export type SetRoundAwardsInput = {
  competitionId: string;
  roundKey: string;
  scheme: string;
  /** Prize text per band of `scheme`; empty text means no prize. */
  prizes?: Partial<Record<string, string>>;
};

export type SetRoundAwardsResult =
  | { ok: true; changed: boolean }
  | InvalidInput
  | { ok: false; error: "not_found" | RoundAwardsError };

const setRoundAwardsInput = z.object({
  competitionId: z.uuid(),
  roundKey: z.string().max(40),
  scheme: z.string().max(40),
  // Long enough to reach the prize length check, which counts characters.
  prizes: z.record(z.string().max(40), z.string().max(2000)).default({}),
});

/**
 * Sets one round's scheme and prizes. Switching scheme keeps only the
 * prizes whose band the new scheme has. Setting what is already there is
 * a no-op (`changed: false`) and records nothing.
 */
export async function setRoundAwards(
  ctx: TermsContext,
  input: SetRoundAwardsInput
): Promise<SetRoundAwardsResult> {
  const resource = competitionResource(input.competitionId);
  const { role } = await authorize(ctx, "competition.set_awards", resource);
  const valid = setRoundAwardsInput.safeParse(input);
  if (!valid.success) return invalidInput(valid.error);
  const { competitionId, ...awards } = valid.data;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const found = await lockCompetition(tx, competitionId);
    if (!found) return { ok: false, error: "not_found" } as const;
    const decided = decideRoundAwards(found.participation, awards);
    if (!decided.ok) return decided;
    const next = decided.value;
    const current = (await storedAwards(tx, competitionId)).find(
      (stored) => stored.roundKey === next.roundKey
    ) ?? { roundKey: next.roundKey, scheme: DEFAULT_AWARD_SCHEME, prizes: {} };
    const change = awardsChange(current, next);
    if (!change) return { ok: true, changed: false } as const;

    await tx
      .insert(competitionAwardScheme)
      .values({
        competitionId,
        round: next.roundKey,
        scheme: next.scheme,
        prizes: next.prizes,
        updatedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          competitionAwardScheme.competitionId,
          competitionAwardScheme.round,
        ],
        set: {
          scheme: sql`excluded.scheme`,
          prizes: sql`excluded.prizes`,
          updatedByUserId: sql`excluded.updated_by_user_id`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    await recordAudit(tx, ctx, {
      action: "competition.awards_set",
      entity: { type: "competition", id: competitionId },
      before: change.before,
      after: change.after,
      actorRole: role,
    });
    return { ok: true, changed: true } as const;
  });
}
