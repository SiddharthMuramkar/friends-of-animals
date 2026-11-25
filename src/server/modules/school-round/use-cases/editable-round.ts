// The steps every change to a school round (#89) shares: authorize the
// actor for the institution, then, in one transaction, find the
// institution registration (its competition share-locked, so a
// cancellation waits), lock its round (F15: writers serialise on the round
// row) and check it may still change.
//
// Loads under plain Node: relative imports only, no "server-only".

import { authorize } from "../../../access/can";
import type { Action } from "../../../access/policies";
import type { Role } from "../../../access/domain/roles";
import type { AppDb } from "../../../db/app-db";
import type { SchoolRoundRow } from "../../../db/schema";
import type { UseCaseContext } from "../../../use-cases";
import {
  loadRegistrationScope,
  type RegistrationScope,
} from "../../institution-submissions/registration-scope";
import { institutionResource } from "../../institutions/coordinators/policy";
import { loadRound } from "../store";
import { roundEditable } from "./get-school-round";

export type RoundRefusal = {
  ok: false;
  error: "not_found" | "not_open" | "round_not_editable";
};

export type LockedRound = {
  tx: AppDb;
  scope: RegistrationScope;
  round: SchoolRoundRow;
  role: Role | null;
  userId: string;
};

/**
 * Runs `change` on the locked, editable round of the registration, or
 * answers why it can't.
 */
export async function withLockedRound<R>(
  ctx: UseCaseContext,
  action: Extract<Action, `school_round.${string}`>,
  ref: { institutionId: string; reference: string },
  change: (locked: LockedRound) => Promise<R>
): Promise<R | RoundRefusal> {
  const { role } = await authorize(
    ctx,
    action,
    institutionResource(ref.institutionId)
  );
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const userId = ctx.actor.userId;
  return ctx.db.transaction(async (tx): Promise<R | RoundRefusal> => {
    const scope = await loadRegistrationScope(tx, ref, { lock: true });
    if (!scope) return { ok: false, error: "not_found" };
    const round = await loadRound(tx, scope.id, { lock: true });
    if (!round) return { ok: false, error: "not_open" };
    if (!roundEditable(round.status, scope.competition.status)) {
      return { ok: false, error: "round_not_editable" };
    }
    return change({ tx, scope, round, role, userId });
  });
}
