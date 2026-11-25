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
import { isConductCertified } from "../../institution-submissions/conduct";
import type { FinaliseBlocker } from "../domain/finalise";
import { applyFinalOutcomes } from "../apply-final-outcomes";
import { JUDGING_STATEMENT_VERSION } from "../domain/judging-statement";
import { assertSchoolRoundTransition } from "../domain/status";
import { loadPanel, recordRoundTransition } from "../store";
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
      assertSchoolRoundTransition(round.status, "finalised");
      const applied = await applyFinalOutcomes(tx, ctx, {
        roundId: round.id,
        institutionRegistrationId: scope.id,
        shortlistOnly: scope.competition.digitalScope === "shortlist_only",
        role,
        prerequisites: {
          panelSize: (await loadPanel(tx, round.id)).length,
          conductCertified: await isConductCertified(tx, scope.id),
          judgingAttested,
        },
      });
      if (!applied.ok) return applied;
      const { shortlisted, notShortlisted } = applied;
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
