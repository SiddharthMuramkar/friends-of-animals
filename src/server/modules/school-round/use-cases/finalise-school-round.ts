// finaliseSchoolRound({ institutionId, reference, judgingAttested }) (#89):
// the coordinator attests the judging and makes the shortlist official, in
// one transaction:
//
// 1. lock the round (F15) and the round's entries, and check it is open;
// 2. gather the facts (panel, conduct certification from #87, the
//    attestation, every entry, the saved picks) and ask the pure planner
//    (../domain/finalise.ts) for each entry's outcome, or every blocker;
// 3. move each entry through the entries module: a pick goes
//    school_shortlisted → submitted_to_foa (all-participants scope: the
//    file is already uploaded), every other entry not_shortlisted;
// 4. finalise the round, recording the attestation (who, when, which
//    statement version) with it, so it always covers the exact shortlist
//    made official;
// 5. emit school_round.shortlist_finalised (its only producer) and write
//    one audit row.
//
// The families hear by the event's handlers (../family-outcomes.ts). The
// shortlist-only scope promotes each created entry once its file is live.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../../../audit/record";
import { schoolRound } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import { emit } from "../../../outbox/emit";
import type { UseCaseContext } from "../../../use-cases";
import { applySchoolRoundOutcome } from "../../entries/school-round-outcome";
import { isConductCertified } from "../../institution-submissions/conduct";
import { planFinalisation, type FinaliseBlocker } from "../domain/finalise";
import { planShortlistOnlyRound } from "../shortlist-only-outcomes";
import { JUDGING_STATEMENT_VERSION } from "../domain/judging-statement";
import { assertSchoolRoundTransition } from "../domain/status";
import {
  loadPanel,
  loadPicks,
  loadRoundEntries,
  recordRoundTransition,
} from "../store";
import { withLockedRound, type RoundRefusal } from "./editable-round";
import { roundInput } from "./get-school-round";

const finaliseInput = roundInput.extend({ judgingAttested: z.boolean() });

export type FinaliseSchoolRoundInput = z.input<typeof finaliseInput>;

export type FinaliseSchoolRoundResult =
  | {
      ok: true;
      finalisedAt: Date;
      shortlisted: number;
      notShortlisted: number;
    }
  | InvalidInput
  | RoundRefusal
  | { ok: false; error: "shortlist_only" }
  | { ok: false; error: "finalise_blocked"; blockers: FinaliseBlocker[] };

export async function finaliseSchoolRound(
  ctx: UseCaseContext,
  input: FinaliseSchoolRoundInput
): Promise<FinaliseSchoolRoundResult> {
  const parsed = finaliseInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { judgingAttested, ...ref } = parsed.data;
  return withLockedRound(
    ctx,
    "school_round.finalise",
    ref,
    async ({
      tx,
      scope,
      round,
      role,
      userId,
    }): Promise<FinaliseSchoolRoundResult> => {
      const shortlistOnly = scope.competition.digitalScope === "shortlist_only";
      const entries = await loadRoundEntries(tx, scope.id, { lock: true });
      const picks = await loadPicks(tx, round.id);
      const plan = planFinalisation({
        panelSize: (await loadPanel(tx, round.id)).length,
        conductCertified: await isConductCertified(tx, scope.id),
        judgingAttested,
        entries: entries.map((each) => ({
          entryId: each.entryId,
          submitted:
            each.status ===
            (shortlistOnly ? "school_shortlisted" : "submitted"),
        })),
        picks,
      });
      if (!plan.ok) {
        return {
          ok: false,
          error: "finalise_blocked",
          blockers: plan.blockers,
        };
      }
      assertSchoolRoundTransition(round.status, "finalised");

      const shortlistPlan = shortlistOnly
        ? await planShortlistOnlyRound(tx, scope.id, entries)
        : null;
      if (shortlistPlan && !shortlistPlan.ok)
        return {
          ok: false,
          error: "finalise_blocked",
          blockers: shortlistPlan.blockers.map(({ entryId }) => ({
            code: "pick_not_in_round",
            entryId,
          })),
        };
      const outcomes = shortlistPlan?.outcomes ?? plan.outcomes;
      const statusOf = new Map(
        entries.map((each) => [each.entryId, each.status])
      );
      for (const outcome of outcomes) {
        if (outcome.statuses.length === 0) continue;
        await applySchoolRoundOutcome(tx, ctx, {
          entryId: outcome.entryId,
          from: statusOf.get(outcome.entryId)!,
          statuses: outcome.statuses,
          actorRole: role,
        });
      }
      const now = ctx.clock.now();
      await tx
        .update(schoolRound)
        .set({
          status: "finalised",
          judgingAttestedByUserId: userId,
          judgingAttestedAt: now,
          judgingStatementVersion: JUDGING_STATEMENT_VERSION,
          finalisedByUserId: userId,
          finalisedAt: now,
          updatedAt: now,
        })
        .where(eq(schoolRound.id, round.id));
      await recordRoundTransition(tx, ctx, {
        roundId: round.id,
        from: round.status,
        to: "finalised",
      });
      await emit(tx, ctx.clock, {
        type: "school_round.shortlist_finalised",
        aggregate: { type: "school_round", id: round.id },
        payload: {
          roundId: round.id,
          competitionId: round.competitionId,
          institutionRegistrationId: scope.id,
        },
      });
      const shortlisted = outcomes.filter(
        (outcome) => outcome.outcome === "shortlisted"
      ).length;
      const notShortlisted =
        shortlistPlan?.notShortlisted.length ?? outcomes.length - shortlisted;
      await recordAudit(tx, ctx, {
        action: "school_round.finalised",
        entity: { type: "school_round", id: round.id },
        before: { status: round.status },
        after: {
          status: "finalised",
          shortlisted,
          notShortlisted,
          judgingStatementVersion: JUDGING_STATEMENT_VERSION,
        },
        actorRole: role,
      });
      return { ok: true, finalisedAt: now, shortlisted, notShortlisted };
    }
  );
}
