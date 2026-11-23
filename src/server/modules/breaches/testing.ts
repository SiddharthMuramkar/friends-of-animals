// Shared set-up for the breach log's Seam 1 tests: staff who passed their
// second factor, a breach as staff would type it, and readers for the rows
// a compliance rule cares about (audit, timeline, notices). Test code only;
// nothing in the app imports it.

import { asc, eq } from "drizzle-orm";

import type { Role } from "@/server/access";
import type { Actor } from "@/server/actor";
import {
  auditLog,
  breachNotification,
  breachRecord,
  breachTimelineEvent,
} from "@/server/db/schema";
import type { Harness } from "@/test/harness";

/** A signed-in user holding `role` globally, second factor passed. */
export async function staffActor(h: Harness, role: Role): Promise<Actor> {
  const account = await h.seed.member();
  await h.seed.grant(account, { role, scope: { type: "global" } });
  return h.signIn(account);
}

/** The user id of a signed-in actor. */
export function userIdOf(actor: Actor): string {
  if (actor.kind !== "user") throw new Error("Not a signed-in user");
  return actor.userId;
}

/** What staff type in when they learn of a breach. */
export function breachDetails(
  h: Harness,
  overrides: Record<string, unknown> = {}
) {
  return {
    title: "Entry export emailed to the wrong school",
    awareAt: new Date(h.clock.now().getTime() - 2 * 60 * 60 * 1000),
    severity: "high",
    personalDataInvolved: true,
    minorsAffected: true,
    affectedCount: 3,
    impact: "Names and schools of three entrants reached another school.",
    ...overrides,
  } as const;
}

/** Records a breach as `actor` and returns its id. */
export async function recordedBreach(
  h: Harness,
  actor: Actor,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const result = await h.as(actor).recordBreach(breachDetails(h, overrides));
  if (!result.ok) throw new Error(`Recording failed: ${result.error}`);
  return result.id;
}

/** The breach's audit rows, oldest first. */
export async function breachAudit(h: Harness, breachId?: string) {
  const rows = await h.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityType, "breach"))
    .orderBy(asc(auditLog.id));
  return breachId ? rows.filter((row) => row.entityId === breachId) : rows;
}

/** The breach's timeline, oldest first, as kinds. */
export async function timelineKinds(h: Harness, breachId: string) {
  const rows = await h.db
    .select({ kind: breachTimelineEvent.kind })
    .from(breachTimelineEvent)
    .where(eq(breachTimelineEvent.breachId, breachId))
    .orderBy(asc(breachTimelineEvent.occurredAt), asc(breachTimelineEvent.id));
  return rows.map((row) => row.kind);
}

/** The breach's row, as stored. */
export async function storedBreach(h: Harness, breachId: string) {
  const [row] = await h.db
    .select()
    .from(breachRecord)
    .where(eq(breachRecord.id, breachId));
  if (!row) throw new Error(`No breach ${breachId}`);
  return row;
}

/** Every notice row of the breach, as recipient and channel. */
export async function noticeRows(h: Harness, breachId: string) {
  const rows = await h.db
    .select({
      recipientUserId: breachNotification.recipientUserId,
      channel: breachNotification.channel,
      recipientRole: breachNotification.recipientRole,
      aboutCount: breachNotification.aboutCount,
    })
    .from(breachNotification)
    .where(eq(breachNotification.breachId, breachId));
  return rows.sort((a, b) =>
    `${a.recipientUserId}${a.channel}` < `${b.recipientUserId}${b.channel}`
      ? -1
      : 1
  );
}
