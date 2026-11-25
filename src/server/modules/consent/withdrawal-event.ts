import { and, eq, isNull } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { consentEvent, type ConsentEventRow } from "../../db/schema";
import type { EventOf } from "../../outbox/events";

/** Resolve the exact immutable event named by a withdrawal delivery. An
 * event about another subject, purpose or document cannot invalidate a grant. */
export async function resolveWithdrawalEvent(
  db: AppDb,
  payload: EventOf<"consent.withdrawn">["payload"]
) {
  const [event] = await db
    .select()
    .from(consentEvent)
    .where(
      and(
        eq(consentEvent.id, payload.consentEventId),
        eq(consentEvent.action, "withdrawn"),
        eq(consentEvent.subjectType, payload.subjectType),
        eq(consentEvent.subjectId, payload.subjectId),
        payload.competitionId === null
          ? isNull(consentEvent.competitionId)
          : eq(consentEvent.competitionId, payload.competitionId),
        eq(consentEvent.purpose, payload.purpose),
        eq(consentEvent.documentId, payload.documentId)
      )
    );
  return event ?? null;
}

/** Match the consent log's ordering: profile-scoped events use monotonic
 * ids; user-scoped events are ordered by occurrence time then id. */
export function consentEventFollows(
  event: ConsentEventRow,
  grant: ConsentEventRow
) {
  return event.subjectType === "participant_profile"
    ? event.id > grant.id
    : event.occurredAt > grant.occurredAt ||
        (+event.occurredAt === +grant.occurredAt && event.id > grant.id);
}
