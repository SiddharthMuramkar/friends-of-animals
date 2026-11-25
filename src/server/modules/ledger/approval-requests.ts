// Making a two-approver request (#109): a money operation that waits as a
// pending `finance_approval` row until a second, different finance user
// approves it (./approvals.ts). Its expiry is fixed when it is made, from
// the `ledger.approvalExpiryDays` setting then.

import type { PolicyContext } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { financeApproval } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { readSetting } from "../settings/read";

import { approvalExpiresAt, type FinanceOperation } from "./domain/approval";

export async function insertFinanceRequest(
  tx: AppDb,
  ctx: PolicyContext,
  actorRole: Role | null,
  request: {
    operation: FinanceOperation;
    /** What the operation needs to run. May hold finance's own words. */
    payload: Record<string, unknown>;
    /** Ids, months and amounts for the audit log: never free text. */
    audit: Record<string, unknown>;
  }
): Promise<string> {
  if (ctx.actor.kind !== "user") throw new Error("Only a user makes requests");
  const now = ctx.clock.now();
  const id = uuidv7(now);
  const expiryDays = await readSetting(tx, "ledger.approvalExpiryDays");
  await tx.insert(financeApproval).values({
    id,
    operation: request.operation,
    payload: request.payload,
    requestedByUserId: ctx.actor.userId,
    requestedAt: now,
    expiresAt: approvalExpiresAt(now, expiryDays),
  });
  await recordAudit(tx, ctx, {
    action: "ledger.approval_requested",
    entity: { type: "finance_approval", id },
    before: null,
    after: {
      operation: request.operation,
      status: "pending",
      ...request.audit,
    },
    actorRole,
  });
  return id;
}
