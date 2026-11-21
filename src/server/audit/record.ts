// Writing to the audit log (#59). A use case that changes something calls
// `recordAudit` in the same transaction as the change, so the entry and the
// change commit or roll back together. Loads under plain Node (the
// bootstrap command): relative imports only, no "server-only".

import type { Role } from "../access/domain/roles";
import type { Actor } from "../actor";
import type { AppDb } from "../db/app-db";
import { auditLog } from "../db/schema";
import { monotonicUuidv7 } from "../ids";
import type { Clock } from "../ports/clock";

export type AuditEntry = {
  /** `<entity>.<past-tense verb>`, e.g. `role.granted`. */
  action: string;
  entity: { type: string; id: string };
  /** Ids and the changed fields only, never a whole row with personal data. */
  before: unknown;
  after: unknown;
  /** The role that allowed the action (from `authorize`), or null. */
  actorRole: Role | null;
};

/**
 * Entries made in one millisecond still sort in the order they were made,
 * so "newest first" holds within this process.
 */
const nextAuditId = monotonicUuidv7();

/** Appends one entry, stamped by the clock, for the acting `actor`. */
export async function recordAudit(
  db: AppDb,
  { clock, actor }: { clock: Clock; actor: Actor },
  entry: AuditEntry
): Promise<void> {
  const now = clock.now();
  const meta = actor.kind === "system" ? undefined : actor.meta;
  await db.insert(auditLog).values({
    id: nextAuditId(now),
    occurredAt: now,
    actorKind: actor.kind,
    actorUserId: actor.kind === "user" ? actor.userId : null,
    actorProcess: actor.kind === "system" ? actor.process : null,
    actorRole: entry.actorRole,
    action: entry.action,
    entityType: entry.entity.type,
    entityId: entry.entity.id,
    before: entry.before,
    after: entry.after,
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  });
}
