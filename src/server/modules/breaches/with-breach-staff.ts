// The one way into a breach use case (#116). `withBreachStaff` checks the
// actor may take the action, opens the transaction the work runs in, and
// writes the audit row the work asks for in that same transaction. A step
// that refuses (or finds nothing) returns no audit row and writes nothing,
// so a refused change leaves no row, timeline event or audit entry.
//
// Loads under plain Node: relative imports only, no "server-only".

import { authorize } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import type { UseCaseContext } from "../../use-cases";
import type { BreachAudit, BreachAuditAction } from "./domain/audit";
import type { BreachAction } from "./policy";

/** What the breach use cases run against. */
export type BreachContext = Pick<
  UseCaseContext,
  "db" | "clock" | "actor" | "cipher"
>;

/** The audit row a step asks for; snapshots come from ./domain/audit. */
export type BreachAuditRow = {
  action: BreachAuditAction;
  breachId: string;
  before: BreachAudit | null;
  after: BreachAudit;
};

/** A step's result, and the audit row to write when it changed something. */
export type BreachStep<T> = { result: T; audit?: BreachAuditRow };

/** The signed-in staff member taking the action. */
export type BreachStaff = { userId: string; role: Role | null };

/**
 * Runs `step` as a signed-in member of breach staff, in one transaction
 * that also holds its audit row. Throws DomainError("forbidden"), or #60's
 * second-factor refusal, for anyone else, before any work.
 */
export async function withBreachStaff<T>(
  ctx: BreachContext,
  action: BreachAction,
  step: (tx: AppDb, staff: BreachStaff) => Promise<BreachStep<T>>
): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    const { role } = await authorize({ ...ctx, db: tx }, action);
    if (ctx.actor.kind !== "user") {
      throw new Error("Breach staff are always signed-in users");
    }
    const { result, audit } = await step(tx, {
      userId: ctx.actor.userId,
      role,
    });
    if (audit) {
      await recordAudit(tx, ctx, {
        action: audit.action,
        entity: { type: "breach", id: audit.breachId },
        before: audit.before,
        after: audit.after,
        actorRole: role,
      });
    }
    return result;
  });
}
