// Telling the people a breach affected (#116 AC4).
//
//   notifyAffectedUsers({ breachId, subjects })
//
// `subjects` lists accounts, child profiles and account email addresses
// (up to 500), or is "all_users". A list is planned in the request: each
// person is resolved (./affected.ts), the pure planner
// (./domain/notice-recipients.ts) routes children to their guardians and
// merges a parent of two affected children into one notice, and
// `queueNotices` saves one breach_notification row per recipient and
// channel. Only a recipient whose rows are new gets a
// `breach.principal_notice` event, which #69's dispatcher sends by route
// row (required by law; audience `breach_recipient`). The rows' unique key
// keeps a replay on its original event. "all_users" creates one job per
// breach, which plans 500 accounts a page in the worker (./fan-out.ts).
//
// The first notice moves the breach to `notified` and stamps
// principals_notified_at, with one timeline event and one audit row that
// counts the recipient (never who got the notice). A replay can retry failed work
// without another lifecycle change. Someone no notice can reach (a child with no
// active guardian, someone with no account) is returned and kept in
// breach_unreachable, so staff see the gap; once they become reachable, a
// later call takes them off that list.
//
// A guardian already told about one child isn't told again about another
// added later: the notice is once per recipient (HR-50 residue: a follow-up
// notice). Loads under plain Node: relative imports only.

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  breachFanOut,
  breachNotification,
  breachRecord,
  breachUnreachable,
  outbox,
  user,
  type BreachRecordRow,
} from "../../db/schema";
import { monotonicUuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { emit, emitBatch } from "../../outbox/emit";
import type { Clock } from "../../ports/clock";
import { normaliseEmailAddress } from "../../ports/email";
import { affectedPeople } from "./affected";
import { breachAuditSnapshot } from "./domain/audit";
import { decideBreachTransition } from "./domain/breach-status";
import {
  BREACH_FAN_OUT_PAGE_SIZE,
  planBreachNotices,
  type AffectedRef,
  type NoticePlan,
  type UnreachablePerson,
} from "./domain/notice-recipients";
import { appendTimeline, CLOSED, lockBreach, NOT_FOUND } from "./record";
import { PRINCIPAL_NOTICE, PRINCIPAL_NOTICE_CHANNELS } from "./notice-message";
import { retryBreachEvents } from "./outbox";
import { withBreachStaff, type BreachContext } from "./with-breach-staff";

const nextNoticeId = monotonicUuidv7();

/**
 * Saves the plan's notices and unreachable people for `breachId`, and
 * emits one notice event per recipient not told before. Reports changes
 * to new and pending notices.
 */
export async function queueNotices(
  tx: AppDb,
  clock: Clock,
  breachId: string,
  plan: NoticePlan,
  reached: readonly AffectedRef[]
): Promise<{ queued: number; scopeChanged: boolean }> {
  const now = clock.now();
  let queued = 0;
  let scopeChanged = false;
  const values = plan.recipients.flatMap((recipient) =>
    PRINCIPAL_NOTICE_CHANNELS.map((channel) => ({
      id: nextNoticeId(now),
      breachId,
      recipientUserId: recipient.userId,
      channel,
      recipientRole: recipient.as,
      aboutCount: recipient.about.length,
      guardianProfileIds: recipient.guardianProfileIds,
      queuedAt: now,
    }))
  );
  if (values.length > 0) {
    // Conflicts are locked by the upsert. Only unsent channels can gain scope.
    const stored = breachNotification;
    const newProfiles = sql`excluded.guardian_profile_ids`;
    const profiles = sql`array(select distinct unnest(${stored.guardianProfileIds} || ${newProfiles}))`;
    const role = sql`case when ${stored.recipientRole} = excluded.recipient_role
      then ${stored.recipientRole} else 'principal_and_guardian' end`;
    const changed = await tx
      .insert(stored)
      .values(values)
      .onConflictDoUpdate({
        target: [stored.breachId, stored.recipientUserId, stored.channel],
        set: {
          guardianProfileIds: profiles,
          recipientRole: role,
          aboutCount: sql`cardinality(${profiles}) + case when (${role}) = 'guardian' then 0 else 1 end`,
        },
        setWhere: and(
          isNull(stored.sentAt),
          isNull(stored.suppressedAt),
          sql`(${stored.recipientRole} <> (${role})
            or not (${stored.guardianProfileIds} @> ${newProfiles}))`
        )!,
      })
      .returning({ id: stored.id, recipientUserId: stored.recipientUserId });
    const proposedIds = new Set(values.map(({ id }) => id));
    const recipients = new Set<string>();
    for (const row of changed) {
      if (row.recipientUserId && proposedIds.has(row.id)) {
        recipients.add(row.recipientUserId);
      } else {
        scopeChanged = true;
      }
    }
    queued = recipients.size;
    await emitBatch(
      tx,
      clock,
      [...recipients].map((recipientUserId) => ({
        type: PRINCIPAL_NOTICE,
        aggregate: { type: "breach", id: breachId },
        payload: { breachId, recipientUserId },
      }))
    );
  }

  await recordUnreachable(tx, breachId, now, plan.unreachable);
  for (const type of ["user", "participant_profile"] as const) {
    const ids = reached.filter((ref) => ref.type === type).map((r) => r.id);
    if (ids.length === 0) continue;
    await tx
      .delete(breachUnreachable)
      .where(
        and(
          eq(breachUnreachable.breachId, breachId),
          eq(breachUnreachable.subjectType, type),
          inArray(breachUnreachable.subjectId, ids)
        )
      );
  }
  return { queued, scopeChanged };
}

export async function recordUnreachable(
  tx: AppDb,
  breachId: string,
  now: Date,
  people: readonly UnreachablePerson[]
): Promise<void> {
  if (people.length === 0) return;
  await tx
    .insert(breachUnreachable)
    .values(
      people.map(({ ref, reason }) => ({
        breachId,
        subjectType: ref.type,
        subjectId: ref.id,
        reason,
        recordedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: [
        breachUnreachable.breachId,
        breachUnreachable.subjectType,
        breachUnreachable.subjectId,
      ],
      set: { reason: sql`excluded.reason`, recordedAt: now },
    });
}

/** The people in `people` the plan reaches (everyone it lists as unreachable aside). */
export function reachedRefs(
  refs: readonly AffectedRef[],
  plan: NoticePlan
): AffectedRef[] {
  return refs.filter(
    (ref) =>
      !plan.unreachable.some(
        (person) => person.ref.type === ref.type && person.ref.id === ref.id
      )
  );
}

const subject = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("user"), id: z.uuid() }),
  z.strictObject({ type: z.literal("participant_profile"), id: z.uuid() }),
  z.strictObject({
    type: z.literal("email"),
    address: z
      .string()
      .transform((address) => normaliseEmailAddress(address))
      .pipe(z.email()),
  }),
]);

const notifyInput = z.strictObject({
  breachId: z.uuid(),
  subjects: z.union([
    z.enum(["all_users", "retry_pending"]),
    z.array(subject).min(1).max(BREACH_FAN_OUT_PAGE_SIZE),
  ]),
});

export type NotifySubject = z.input<typeof subject>;

export type NotifyAffectedUsersResult =
  | {
      ok: true;
      /** Recipients newly queued; 0 on a replay or a background request. */
      noticesQueued: number;
      unreachable: UnreachablePerson[];
      /** Addresses typed that belong to no account. */
      unmatchedEmails: string[];
      /** True when every account is being told by the fan-out job. */
      fanOut: boolean;
    }
  | InvalidInput
  | { ok: false; error: "not_found" | "breach_closed" };

/** Notifies the people a breach touched, or every account. */
export async function notifyAffectedUsers(
  ctx: BreachContext,
  input: unknown
): Promise<NotifyAffectedUsersResult> {
  return withBreachStaff<NotifyAffectedUsersResult>(
    ctx,
    "breach.notify",
    async (tx) => {
      const parsed = notifyInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const { breachId, subjects } = parsed.data;

      const breach = await lockBreach(tx, breachId);
      if (!breach) return { result: NOT_FOUND };
      const now = ctx.clock.now();
      if (subjects === "retry_pending") {
        const retried = await retryBreachEvents(
          tx,
          breachId,
          now,
          inArray(outbox.eventType, [
            "breach.fan_out_requested",
            PRINCIPAL_NOTICE,
          ])
        );
        const snapshot = breachAuditSnapshot(breach);
        return {
          result: {
            ok: true,
            noticesQueued: 0,
            unreachable: [],
            unmatchedEmails: [],
            fanOut: false,
          },
          ...(retried
            ? {
                audit: {
                  action: "breach.principal_notices_requeued",
                  breachId,
                  before: snapshot,
                  after: snapshot,
                },
              }
            : {}),
        };
      }
      if (!decideBreachTransition(breach, "notify").ok)
        return { result: CLOSED };

      if (subjects === "all_users") {
        const result = {
          ok: true as const,
          noticesQueued: 0,
          unreachable: [],
          unmatchedEmails: [],
          fanOut: true,
        };
        const [job] = await tx
          .insert(breachFanOut)
          .values({ breachId })
          .onConflictDoNothing()
          .returning({ breachId: breachFanOut.breachId });
        if (!job) {
          await retryBreachEvents(
            tx,
            breachId,
            now,
            inArray(outbox.eventType, [
              "breach.fan_out_requested",
              PRINCIPAL_NOTICE,
            ])
          );
          return { result };
        }
        await emit(tx, ctx.clock, {
          type: "breach.fan_out_requested",
          aggregate: { type: "breach", id: breachId },
          payload: {
            breachId,
            afterUserId: null,
            pageSize: BREACH_FAN_OUT_PAGE_SIZE,
          },
        });
        const snapshot = breachAuditSnapshot(breach);
        return {
          result,
          audit: {
            action: "breach.fan_out_requested",
            breachId,
            before: snapshot,
            after: snapshot,
          },
        };
      }

      const { refs, unmatchedEmails } = await subjectRefs(tx, subjects);
      const people = await affectedPeople(tx, ctx.cipher, now, refs);
      const plan = planBreachNotices(people);
      const { queued, scopeChanged } = await queueNotices(
        tx,
        ctx.clock,
        breachId,
        plan,
        reachedRefs(refs, plan)
      );
      if (plan.recipients.length > queued) {
        await retryBreachEvents(
          tx,
          breachId,
          now,
          eq(outbox.eventType, PRINCIPAL_NOTICE),
          inArray(
            sql<string>`${outbox.payload}->>'recipientUserId'`,
            plan.recipients.map(({ userId }) => userId)
          )
        );
      }

      const result = {
        ok: true as const,
        noticesQueued: queued,
        unreachable: plan.unreachable,
        unmatchedEmails,
        fanOut: false,
      };
      if (!queued && !scopeChanged) return { result };
      const snapshot = breachAuditSnapshot(breach);
      return {
        result,
        audit: {
          action: queued
            ? "breach.principal_notices_queued"
            : "breach.principal_notice_scope_updated",
          breachId,
          before: snapshot,
          after: snapshot,
        },
      };
    }
  );
}

/** Records the first successful channel for a recipient under the breach lock. */
export async function recordPrincipalDelivery(
  tx: AppDb,
  clock: Clock,
  breach: BreachRecordRow,
  recipientUserId: string,
  at: Date
): Promise<void> {
  const [prior] = await tx
    .select({ id: breachNotification.id })
    .from(breachNotification)
    .where(
      and(
        eq(breachNotification.breachId, breach.id),
        eq(breachNotification.recipientUserId, recipientUserId),
        isNotNull(breachNotification.sentAt)
      )
    )
    .limit(1);
  if (prior) return;

  const first = breach.principalsNotifiedAt === null;
  let updated = breach;
  if (first) {
    const decision = decideBreachTransition(breach, "notify");
    const [row] = await tx
      .update(breachRecord)
      .set({
        status: decision.ok ? decision.to : breach.status,
        principalsNotifiedAt: at,
        updatedAt: at,
      })
      .where(eq(breachRecord.id, breach.id))
      .returning();
    if (!row) throw new Error("Breach vanished while locked");
    updated = row;
    await appendTimeline(tx, {
      breachId: breach.id,
      kind: "principals_notified",
      authorUserId: null,
      at,
    });
  }
  await recordAudit(
    tx,
    { clock, actor: { kind: "system", process: "worker" } },
    {
      action: first
        ? "breach.principals_notified"
        : "breach.principal_notice_delivered",
      entity: { type: "breach", id: breach.id },
      actorRole: null,
      before: breachAuditSnapshot(breach),
      after: breachAuditSnapshot(updated, { noticesSent: 1 }),
    }
  );
}

/** The subjects as account and profile refs; emails become their accounts. */
async function subjectRefs(
  tx: AppDb,
  subjects: readonly z.output<typeof subject>[]
): Promise<{ refs: AffectedRef[]; unmatchedEmails: string[] }> {
  const emails = [
    ...new Set(
      subjects.flatMap((item) => (item.type === "email" ? [item.address] : []))
    ),
  ];
  const accounts =
    emails.length === 0
      ? []
      : await tx
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(inArray(user.email, emails));
  const byEmail = new Map(accounts.map((row) => [row.email, row.id]));
  const refs: AffectedRef[] = [];
  for (const item of subjects) {
    if (item.type !== "email") {
      refs.push({ type: item.type, id: item.id });
      continue;
    }
    const id = byEmail.get(item.address);
    if (id) refs.push({ type: "user", id });
  }
  return {
    refs,
    unmatchedEmails: emails.filter((email) => !byEmail.has(email)),
  };
}
