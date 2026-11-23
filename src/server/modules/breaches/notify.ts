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
// counts the notices (never who got them). A replay can retry failed work
// without another lifecycle change. Someone no notice can reach (a child with no
// active guardian, someone with no account) is returned and kept in
// breach_unreachable, so staff see the gap; once they become reachable, a
// later call takes them off that list.
//
// A guardian already told about one child isn't told again about another
// added later: the notice is once per recipient (HR-50 residue: a follow-up
// notice). Loads under plain Node: relative imports only.

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../../db/app-db";
import {
  breachFanOut,
  breachNotification,
  breachRecord,
  breachUnreachable,
  outbox,
  user,
} from "../../db/schema";
import { monotonicUuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox/emit";
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
import { withBreachStaff, type BreachContext } from "./with-breach-staff";

const nextNoticeId = monotonicUuidv7();

/**
 * Saves the plan's notices and unreachable people for `breachId`, and
 * emits one notice event per recipient not told before. Returns how many
 * recipients were newly queued.
 */
export async function queueNotices(
  tx: AppDb,
  clock: Clock,
  breachId: string,
  plan: NoticePlan,
  reached: readonly AffectedRef[]
): Promise<number> {
  const now = clock.now();
  let queued = 0;
  for (const recipient of plan.recipients) {
    const inserted = await tx
      .insert(breachNotification)
      .values(
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
      )
      .onConflictDoNothing({
        target: [
          breachNotification.breachId,
          breachNotification.recipientUserId,
          breachNotification.channel,
        ],
      })
      .returning({ id: breachNotification.id });
    if (inserted.length === 0) continue;
    await emit(tx, clock, {
      type: PRINCIPAL_NOTICE,
      aggregate: { type: "breach", id: breachId },
      payload: { breachId, recipientUserId: recipient.userId },
    });
    queued += 1;
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
  return queued;
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

/** Resubmission gives the original failed events another chance. */
async function retryBreachEvents(
  tx: AppDb,
  breachId: string,
  now: Date,
  ...matches: [SQL, ...SQL[]]
) {
  await tx
    .update(outbox)
    .set({
      status: "pending",
      attempts: 0,
      availableAt: now,
      lockedUntil: null,
      failedAt: null,
      lastError: null,
    })
    .where(
      and(
        eq(outbox.aggregateType, "breach"),
        eq(outbox.aggregateId, breachId),
        eq(outbox.status, "failed"),
        ...matches
      )
    );
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
    z.literal("all_users"),
    z.array(subject).min(1).max(BREACH_FAN_OUT_PAGE_SIZE),
  ]),
});

export type NotifySubject = z.input<typeof subject>;

export type NotifyAffectedUsersResult =
  | {
      ok: true;
      /** Recipients newly told; 0 on a replay, and for "all_users". */
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
    async (tx, staff) => {
      const parsed = notifyInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const { breachId, subjects } = parsed.data;

      const breach = await lockBreach(tx, breachId);
      if (!breach) return { result: NOT_FOUND };
      const decision = decideBreachTransition(breach, "notify");
      if (!decision.ok) return { result: CLOSED };
      const now = ctx.clock.now();

      let queued = 0;
      let unreachable: UnreachablePerson[] = [];
      let unmatchedEmails: string[] = [];
      if (subjects === "all_users") {
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
          return {
            result: {
              ok: true,
              noticesQueued: 0,
              unreachable,
              unmatchedEmails,
              fanOut: true,
            },
          };
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
      } else {
        const resolved = await subjectRefs(tx, subjects);
        unmatchedEmails = resolved.unmatchedEmails;
        const people = await affectedPeople(tx, ctx.cipher, now, resolved.refs);
        const plan = planBreachNotices(people);
        unreachable = plan.unreachable;
        queued = await queueNotices(
          tx,
          ctx.clock,
          breachId,
          plan,
          reachedRefs(resolved.refs, plan)
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
      }

      const result = {
        ok: true as const,
        noticesQueued: queued,
        unreachable,
        unmatchedEmails,
        fanOut: subjects === "all_users",
      };
      if (subjects !== "all_users" && queued === 0) return { result };

      const [updated] = await tx
        .update(breachRecord)
        .set({
          status: decision.to,
          principalsNotifiedAt: breach.principalsNotifiedAt ?? now,
          updatedAt: now,
        })
        .where(eq(breachRecord.id, breachId))
        .returning();
      if (!updated) throw new Error(`Breach ${breachId} vanished while locked`);
      await appendTimeline(tx, {
        breachId,
        kind: "principals_notified",
        authorUserId: staff.userId,
        at: now,
      });
      return {
        result,
        audit: {
          action: "breach.principals_notified",
          breachId,
          before: breachAuditSnapshot(breach),
          after: breachAuditSnapshot(
            updated,
            subjects === "all_users" ? {} : { noticesSent: queued }
          ),
        },
      };
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
