// The one way into a grievance officer's use case (#115). `withOfficer`
// checks the actor may take the action, opens the transaction the work
// runs in, and writes the audit row the work describes in that same
// transaction, so a refused or failed step writes nothing at all.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import { authorize } from "../../../access/can";
import type { Role } from "../../../access/domain/roles";
import { recordAudit } from "../../../audit/record";
import type { AppDb } from "../../../db/app-db";
import { privacyRequest, type PrivacyRequestRow } from "../../../db/schema";
import type { UseCaseContext } from "../../../use-cases";
import type { PrivacyRequestsAction } from "./policy";

/** The audit row a step asks for. Snapshots come from ./domain/audit. */
export type OfficerAudit = {
  action: `privacy_request.${string}`;
  entity: { type: "privacy_request"; id: string };
  before: unknown;
  after: unknown;
};

/**
 * What a step returns: its result, and the audit row to write. A step
 * that returns no audit row (a refusal, a request not found) changed
 * nothing.
 */
export type OfficerStep<T> = { result: T; audit?: OfficerAudit };

/** The signed-in grievance officer taking the action. */
export type Officer = { userId: string; role: Role | null };

/**
 * Runs `step` as the signed-in grievance officer, inside one transaction
 * that also holds its audit row. Throws DomainError("forbidden"), or #60's
 * second-factor refusal, for anyone else, before any work.
 */
export async function withOfficer<T>(
  ctx: UseCaseContext,
  action: PrivacyRequestsAction,
  step: (tx: AppDb, officer: Officer) => Promise<OfficerStep<T>>
): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    const { role } = await authorize({ ...ctx, db: tx }, action);
    if (ctx.actor.kind !== "user") {
      throw new Error("A grievance officer is always a signed-in user");
    }
    const { result, audit } = await step(tx, {
      userId: ctx.actor.userId,
      role,
    });
    if (audit) await recordAudit(tx, ctx, { ...audit, actorRole: role });
    return result;
  });
}

/** The request's row, locked until the transaction ends. */
export async function lockRequest(
  tx: AppDb,
  id: string
): Promise<PrivacyRequestRow | undefined> {
  const [row] = await tx
    .select()
    .from(privacyRequest)
    .where(eq(privacyRequest.id, id))
    .for("update");
  return row;
}

export const NOT_FOUND = { ok: false, error: "not_found" } as const;
