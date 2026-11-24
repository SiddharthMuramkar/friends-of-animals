// Running one reminder at its time (#84).
//
//   runReminder({ reminderJobId })   → the worker only
//
// The `reminder.due` event names only the reminder_job row. One short
// transaction locks the row and asks checkReminderAtRunTime
// (domain/schedule.ts) about it against things as they are now: the
// deadline, the offset settings, and whether a nearer reminder for the
// same deadline is due too. A reminder that should go is marked fired
// (with an audit entry by the system); one that shouldn't is superseded
// or cancelled, and one that came early is saved again for its time.
//
// Only then, outside the lock, does it ask the reminder who owes the
// deadline now (checked at run time, not when it was planned), plan
// their deliveries through the notifications module's routes on
// `reminder.due`, and send. Every message is claimed under the row's id,
// so a retry after a failed send, or a second delivery of the event,
// reaches nobody twice: a fired row's run carries on while its deadline
// stands, sending only what didn't go.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, inArray, lt, lte } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { Actor } from "../../actor";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { reminderJob, type ReminderJobRow } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox/emit";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { loadRosterDeliveryPlan } from "../announcements/delivery-plan";
import {
  deliverToRoster,
  type RosterDelivery,
} from "../announcements/roster-delivery";
import {
  checkReminderAtRunTime,
  type RunTimeDecision,
} from "./domain/schedule";
import { valuesForReminder } from "./message-values";
import {
  reminderNamed,
  type ReminderAudience,
  type ReminderDefinition,
} from "./registry";
import { offsetsFor } from "./schedule-reminders";

/** What a run uses: the relay's deps and the actor. */
export type ReminderRunContext = OutboxDeps & { actor: Actor };

/** The routes a reminder's roster is reached through. */
const ROUTE_AUDIENCES = {
  account: "reminder_registrants",
  details: "reminder_contacts",
} as const;

const inputSchema = z.object({ reminderJobId: z.uuid() });

export type RunReminderResult =
  | {
      ok: true;
      outcome: "sent";
      /** How many people it reached, each on the channels open to them. */
      recipients: number;
    }
  | {
      ok: true;
      /** Nothing went now: what the row is, and why. */
      outcome: "skipped";
      status: ReminderJobRow["status"];
      reason: Extract<RunTimeDecision, { run: false }>["reason"] | "unknown";
    }
  | { ok: false; error: "not_found" }
  | InvalidInput;

type Decided =
  | { run: false; result: RunReminderResult }
  | { run: true; row: ReminderJobRow; definition: ReminderDefinition };

/** Whether a nearer reminder for the row's deadline has fired or is due. */
async function nearerDue(
  tx: AppDb,
  row: ReminderJobRow,
  now: Date
): Promise<boolean> {
  const [nearer] = await tx
    .select({ id: reminderJob.id })
    .from(reminderJob)
    .where(
      and(
        eq(reminderJob.reminderName, row.reminderName),
        eq(reminderJob.subjectId, row.subjectId),
        eq(reminderJob.deadlineAt, row.deadlineAt),
        lt(reminderJob.offsetHours, row.offsetHours),
        lte(reminderJob.fireAt, now),
        inArray(reminderJob.status, ["scheduled", "fired"])
      )
    )
    .limit(1);
  return nearer !== undefined;
}

/** Locks the row and decides, recording what the decision changes. */
async function decide(
  ctx: ReminderRunContext,
  reminderJobId: string,
  offsetsHours: (definition: ReminderDefinition) => Promise<number[]>
): Promise<Decided> {
  const now = ctx.clock.now();
  const [peek] = await ctx.db
    .select({ name: reminderJob.reminderName })
    .from(reminderJob)
    .where(eq(reminderJob.id, reminderJobId));
  if (!peek) return { run: false, result: { ok: false, error: "not_found" } };
  const definition = reminderNamed(peek.name);
  // Settings are read on their own connection, before the transaction.
  const offsets = definition ? await offsetsHours(definition) : [];

  return ctx.db.transaction(async (tx): Promise<Decided> => {
    const [row] = await tx
      .select()
      .from(reminderJob)
      .where(eq(reminderJob.id, reminderJobId))
      .for("update");
    if (!row) return { run: false, result: { ok: false, error: "not_found" } };
    if (!definition) {
      // Its reminder has left the code: it can never go.
      if (row.status === "scheduled") {
        await tx
          .update(reminderJob)
          .set({ status: "cancelled", updatedAt: now })
          .where(eq(reminderJob.id, row.id));
      }
      return {
        run: false,
        result: {
          ok: true,
          outcome: "skipped",
          status: row.status === "scheduled" ? "cancelled" : row.status,
          reason: "unknown",
        },
      };
    }
    const decision = checkReminderAtRunTime({
      reminder: row,
      deadline: await definition.deadlineOf(tx, row.subjectId),
      offsetsHours: offsets,
      nearerDue: await nearerDue(tx, row, now),
      now,
    });
    if (decision.run) {
      if (decision.firstRun) {
        await tx
          .update(reminderJob)
          .set({ status: "fired", firedAt: now, updatedAt: now })
          .where(eq(reminderJob.id, row.id));
        await recordAudit(tx, ctx, {
          action: "reminder.fired",
          entity: { type: "reminder_job", id: row.id },
          before: { status: "scheduled" },
          after: {
            status: "fired",
            reminderName: row.reminderName,
            subjectId: row.subjectId,
            offsetHours: row.offsetHours,
            deadlineAt: row.deadlineAt.toISOString(),
          },
          actorRole: null,
        });
      }
      return { run: true, row, definition };
    }
    if (decision.status !== null) {
      await tx
        .update(reminderJob)
        .set({ status: decision.status, updatedAt: now })
        .where(eq(reminderJob.id, row.id));
    }
    if (decision.reason === "not_due") {
      // It came before its time: its job waits until then.
      await emit(
        tx,
        ctx.clock,
        {
          type: "reminder.due",
          aggregate: { type: "reminder_job", id: row.id },
          payload: { reminderJobId: row.id },
        },
        { availableAt: row.fireAt }
      );
    }
    return {
      run: false,
      result: {
        ok: true,
        outcome: "skipped",
        status: decision.status ?? row.status,
        reason: decision.reason,
      },
    };
  });
}

/** Everyone the audience names, on the routes each is reached through. */
async function deliveriesFor(
  ctx: ReminderRunContext,
  definition: ReminderDefinition,
  audience: ReminderAudience,
  at: Date,
  smsEnabled: boolean
): Promise<RosterDelivery[]> {
  const deliveries: RosterDelivery[] = [];
  for (const group of audience.groups) {
    if (group.registrationIds.size === 0) continue;
    const plan = await loadRosterDeliveryPlan(
      ctx,
      {
        eventType: "reminder.due",
        audiences: ROUTE_AUDIENCES,
        templateKey: definition.templateKey,
      },
      audience.competitionId,
      at,
      smsEnabled,
      group.registrationIds
    );
    deliveries.push(
      ...plan.deliveries.filter(({ recipient }) =>
        recipient.roles.some((role) => group.roles.includes(role))
      )
    );
  }
  return deliveries;
}

/**
 * Runs one reminder for things as they are now. A failed send throws
 * after the others went, so the relay retries; the retry sends only what
 * didn't go.
 */
export async function runReminder(
  ctx: ReminderRunContext,
  input: { reminderJobId: string }
): Promise<RunReminderResult> {
  await authorize(ctx, "reminder.run");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const decided = await decide(ctx, parsed.data.reminderJobId, (definition) =>
    offsetsFor(ctx.settings, definition)
  );
  if (!decided.run) return decided.result;
  const { row, definition } = decided;

  const now = ctx.clock.now();
  const audience = await definition.owes(ctx.db, {
    subjectId: row.subjectId,
    deadlineAt: row.deadlineAt,
    now,
  });
  const smsEnabled = await ctx.settings.get("sms.enabled");
  const deliveries = await deliveriesFor(
    ctx,
    definition,
    audience,
    now,
    smsEnabled
  );
  // Every message is claimed under the row's id, whichever delivery runs it.
  const delivery: Delivery<"reminder.due"> = {
    id: row.id,
    eventId: row.id,
    eventType: "reminder.due",
    occurredAt: row.fireAt,
    attempt: 1,
    payload: { reminderJobId: row.id },
  };
  const failure = await deliverToRoster(
    ctx,
    delivery,
    deliveries,
    await valuesForReminder(ctx.db, definition, row),
    smsEnabled
  );
  if (failure !== null) throw failure;
  return {
    ok: true,
    outcome: "sent",
    recipients: new Set(deliveries.map(({ recipient }) => recipient.key)).size,
  };
}

/** The worker, as it runs reminders. */
const WORKER: Actor = { kind: "system", process: "worker" };

/**
 * The outbox handler for `reminder.due`: runs the reminder as the worker.
 * A row that is gone does nothing.
 */
export async function runReminderJob(
  deps: OutboxDeps,
  payload: { reminderJobId: string }
): Promise<void> {
  const result = await runReminder({ ...deps, actor: WORKER }, payload);
  if (!result.ok && result.error === "invalid_input") {
    throw new Error(
      `The reminder job ${payload.reminderJobId} is not valid: ${result.fields.join(", ")}`
    );
  }
}
