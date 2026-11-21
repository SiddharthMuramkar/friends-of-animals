import type { Role } from "../access/domain/roles";
import type { Actor } from "../actor";
import type { AppDb } from "../db/app-db";
import type { Clock } from "../ports/clock";

export type AuditEntry = {
  action: string;
  entity: { type: string; id: string };
  before: unknown;
  after: unknown;
  actorRole: Role | null;
};

export async function recordAudit(
  _db: AppDb,
  _ctx: { clock: Clock; actor: Actor },
  _entry: AuditEntry
): Promise<void> {}
