import type { Role } from "../../access/domain/roles";
import type { AppDb } from "../../db/app-db";
import type { UseCaseContext } from "../../use-cases";
import { applySchoolRoundOutcome } from "../entries/school-round-outcome";
import {
  planFinalisation,
  type FinaliseBlocker,
  type FinaliseFacts,
} from "./domain/finalise";
import { planShortlistOnlyRound } from "./shortlist-only-outcomes";
import { loadPicks, loadRoundEntries } from "./store";

/** Both authorised decisions (coordinator finalise and manager close on
 * behalf) call this under the same competition/round locks. Their distinct
 * eligibility, attestation, transition, audit and event remain with them. */
export async function applyFinalOutcomes(
  tx: AppDb,
  ctx: UseCaseContext,
  input: {
    roundId: string;
    institutionRegistrationId: string;
    shortlistOnly: boolean;
    role: Role | null;
    prerequisites: Pick<
      FinaliseFacts,
      "by" | "panelSize" | "conductCertified" | "judgingAttested"
    >;
  }
): Promise<
  | { ok: true; shortlisted: number; notShortlisted: number }
  | { ok: false; error: "finalise_blocked"; blockers: FinaliseBlocker[] }
> {
  const {
    roundId,
    institutionRegistrationId,
    shortlistOnly,
    role,
    prerequisites,
  } = input;
  const entries = await loadRoundEntries(tx, institutionRegistrationId, {
    lock: true,
  });
  const plan = planFinalisation({
    ...prerequisites,
    entries: entries.map((each) => ({
      entryId: each.entryId,
      submitted:
        each.status === (shortlistOnly ? "school_shortlisted" : "submitted"),
    })),
    picks: await loadPicks(tx, roundId),
  });
  if (!plan.ok)
    return { ok: false, error: "finalise_blocked", blockers: plan.blockers };
  const shortlistPlan = shortlistOnly
    ? await planShortlistOnlyRound(tx, institutionRegistrationId, entries)
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
  const statusOf = new Map(entries.map((each) => [each.entryId, each.status]));
  for (const outcome of outcomes) {
    if (!outcome.statuses.length) continue;
    await applySchoolRoundOutcome(tx, ctx, {
      entryId: outcome.entryId,
      from: statusOf.get(outcome.entryId)!,
      statuses: outcome.statuses,
      actorRole: role,
    });
  }
  const shortlisted = outcomes.filter(
    (e) => e.outcome === "shortlisted"
  ).length;
  return {
    ok: true,
    shortlisted,
    notShortlisted:
      shortlistPlan?.notShortlisted.length ?? outcomes.length - shortlisted,
  };
}
