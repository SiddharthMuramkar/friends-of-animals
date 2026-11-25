// saveShortlist({ institutionId, reference, categoryId, picks }) (#89): the
// coordinator saves one category's whole shortlist: the entries picked
// for FOA judging, each with an optional school position. The rules are
// the pure core's (../domain/picks.ts): only the round's `submitted`
// entries of that category, up to the competition's shortlist size, and
// positions from 1 up to its number of school positions, each held once.
// A save with any problem changes nothing and names every problem; a clean
// one replaces the category's picks. Only while the round is open.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { schoolRound, schoolRoundPick } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import { checkCategoryPicks, type PickProblem } from "../domain/picks";
import { loadRoundEntries } from "../store";
import { withLockedRound, type RoundRefusal } from "./editable-round";
import { limitsOf, roundInput } from "./get-school-round";

const shortlistInput = roundInput.extend({
  categoryId: z.uuid(),
  picks: z
    .array(
      z.object({
        entryId: z.uuid(),
        position: z.int().min(-1000).max(1000).nullable(),
      })
    )
    .max(200),
});

export type SaveShortlistInput = z.input<typeof shortlistInput>;

export type SaveShortlistResult =
  | { ok: true }
  | InvalidInput
  | RoundRefusal
  | { ok: false; error: "unknown_category" }
  | { ok: false; error: "shortlist_invalid"; problems: PickProblem[] };

export async function saveShortlist(
  ctx: UseCaseContext,
  input: SaveShortlistInput
): Promise<SaveShortlistResult> {
  const parsed = shortlistInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { categoryId, picks, ...ref } = parsed.data;
  return withLockedRound(
    ctx,
    "school_round.manage",
    ref,
    async ({ tx, scope, round, userId }): Promise<SaveShortlistResult> => {
      const entries = await loadRoundEntries(tx, scope.id, { lock: true });
      if (!entries.some((each) => each.categoryId === categoryId)) {
        return { ok: false, error: "unknown_category" };
      }
      const check = checkCategoryPicks({
        categoryId,
        candidates: entries.map((each) => ({
          entryId: each.entryId,
          categoryId: each.categoryId ?? "",
          submitted: each.status === "submitted",
        })),
        picks,
        limits: await limitsOf(tx, round.competitionId),
      });
      if (!check.ok) {
        return {
          ok: false,
          error: "shortlist_invalid",
          problems: check.problems,
        };
      }
      const now = ctx.clock.now();
      await tx
        .delete(schoolRoundPick)
        .where(
          and(
            eq(schoolRoundPick.roundId, round.id),
            eq(schoolRoundPick.categoryId, categoryId)
          )
        );
      if (check.picks.length > 0) {
        await tx.insert(schoolRoundPick).values(
          check.picks.map(({ entryId, position }) => ({
            entryId,
            roundId: round.id,
            categoryId,
            position,
            pickedByUserId: userId,
            pickedAt: now,
          }))
        );
      }
      await tx
        .update(schoolRound)
        .set({ updatedAt: now })
        .where(eq(schoolRound.id, round.id));
      return { ok: true };
    }
  );
}
