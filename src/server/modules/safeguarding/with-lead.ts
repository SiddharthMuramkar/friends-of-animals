// The one way into a safeguarding lead's use case (#116). `withLead`
// checks the actor may take the action, opens the transaction the work runs
// in, and writes the audit row the work describes in that same
// transaction. A lead use case gets its transaction only from here, so it
// can't read or change a report without an audit row, and a refused or
// failed step writes nothing at all.
//
// Loads under plain Node: relative imports only, no "server-only".

import { authorize } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import type { UseCaseContext } from "../../use-cases";
import type { SafeguardingAuditAction } from "./domain/audit";
import type { SafeguardingLeadAction } from "./policy";

/** What the lead's use cases run against. */
export type LeadContext = Pick<
  UseCaseContext,
  "db" | "clock" | "actor" | "cipher"
>;

/** The audit row a step asks for. Snapshots come from ./domain/audit. */
export type LeadAudit = {
  action: SafeguardingAuditAction;
  entity: { type: "safeguarding_report" | "safeguarding_queue"; id: string };
  before: unknown;
  after: unknown;
};

/**
 * What a step returns: its result, and the audit row to write. A step
 * that returns no audit row (a refusal, a report not found) changed
 * nothing and showed nothing.
 */
export type LeadStep<T> = { result: T; audit?: LeadAudit };

/** The signed-in lead taking the action. */
export type Lead = { userId: string; role: Role | null };

/**
 * Runs `step` as the signed-in safeguarding lead, inside one transaction
 * that also holds its audit row. Throws DomainError("forbidden"), or #60's
 * second-factor refusal, for anyone else, before any work.
 */
export async function withLead<T>(
  ctx: LeadContext,
  action: SafeguardingLeadAction,
  step: (tx: AppDb, lead: Lead) => Promise<LeadStep<T>>
): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    const { role } = await authorize({ ...ctx, db: tx }, action);
    if (ctx.actor.kind !== "user") {
      throw new Error("A safeguarding lead is always a signed-in user");
    }
    const { result, audit } = await step(tx, {
      userId: ctx.actor.userId,
      role,
    });
    if (audit) await recordAudit(tx, ctx, { ...audit, actorRole: role });
    return result;
  });
}
