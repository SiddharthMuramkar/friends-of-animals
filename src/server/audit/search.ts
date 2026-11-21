// Searching the audit log (#59): by person (who acted, or the user who was
// changed), by entity and by action, newest first, a page at a time. The
// cursor is the last id of the page before; ids are UUIDv7 from the
// clock, so they sort by time and a page never repeats or skips an entry.

import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";

import { authorize, type PolicyContext } from "../access/can";
import type { Role } from "../access/domain/roles";
import type { Actor } from "../actor";
import type { AppDb } from "../db/app-db";
import { auditLog, user } from "../db/schema";
import { invalidInput, type InvalidInput } from "../input";

export type SearchAuditLogInput = {
  /** A user id: entries they made, and entries that changed their account. */
  person?: string;
  entityType?: string;
  /** Needs `entityType`. */
  entityId?: string;
  action?: string;
  /** The `nextCursor` of the page before. */
  cursor?: string;
  /** Entries per page: 1 to 100, 50 by default. */
  limit?: number;
};

export type AuditEntryView = {
  id: string;
  occurredAt: Date;
  actor: {
    kind: Actor["kind"];
    userId: string | null;
    /** The acting user's name now; null for the platform or a deleted account. */
    name: string | null;
    process: "seed" | "worker" | "cli" | null;
    role: Role | null;
  };
  action: string;
  entity: { type: string; id: string };
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
};

export type SearchAuditLogResult =
  | { ok: true; entries: AuditEntryView[]; nextCursor: string | null }
  | InvalidInput;

const filterText = (max: number) => z.string().trim().min(1).max(max);

const searchAuditLogInput = z
  .object({
    person: z.uuid().optional(),
    entityType: filterText(64).optional(),
    entityId: filterText(200).optional(),
    action: filterText(100).optional(),
    cursor: z.uuid().optional(),
    limit: z.int().min(1).max(100).default(50),
  })
  .refine((input) => input.entityId === undefined || input.entityType, {
    message: "entityId needs entityType",
    path: ["entityId"],
  });

type Filters = z.output<typeof searchAuditLogInput>;

function conditions(filters: Filters): (SQL | undefined)[] {
  const { person, entityType, entityId, action, cursor } = filters;
  return [
    person === undefined
      ? undefined
      : or(
          eq(auditLog.actorUserId, person),
          and(eq(auditLog.entityType, "user"), eq(auditLog.entityId, person))
        ),
    entityType === undefined ? undefined : eq(auditLog.entityType, entityType),
    entityId === undefined ? undefined : eq(auditLog.entityId, entityId),
    action === undefined ? undefined : eq(auditLog.action, action),
    cursor === undefined ? undefined : lt(auditLog.id, cursor),
  ];
}

async function findEntries(db: AppDb, filters: Filters) {
  return (
    db
      .select({ entry: auditLog, actorName: user.name })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorUserId))
      .where(and(...conditions(filters)))
      .orderBy(desc(auditLog.id))
      // One more than a page says whether another page follows.
      .limit(filters.limit + 1)
  );
}

export async function searchAuditLog(
  ctx: PolicyContext,
  input: SearchAuditLogInput
): Promise<SearchAuditLogResult> {
  await authorize(ctx, "audit.search");
  const parsed = searchAuditLogInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const filters = parsed.data;

  const rows = await findEntries(ctx.db, filters);
  const page = rows.slice(0, filters.limit);
  const entries = page.map(({ entry, actorName }): AuditEntryView => ({
    id: entry.id,
    occurredAt: entry.occurredAt,
    actor: {
      kind: entry.actorKind,
      userId: entry.actorUserId,
      name: actorName,
      process: entry.actorProcess,
      role: entry.actorRole,
    },
    action: entry.action,
    entity: { type: entry.entityType, id: entry.entityId },
    before: entry.before,
    after: entry.after,
    ip: entry.ip,
    userAgent: entry.userAgent,
  }));
  const nextCursor =
    rows.length > filters.limit ? (page.at(-1)?.entry.id ?? null) : null;
  return { ok: true, entries, nextCursor };
}
