// The relay: claims the deliveries that are due, runs their handlers and
// settles each one (./retry-policy.ts): dispatched, pending again after a
// backoff, or failed and kept for staff to see. The same code runs in the
// VPS worker (#61's worker runtime), the preview drain route and the Seam 1
// harness (`h.drain()`), so tests drain with the real relay on PGlite.
//
// Every time comes from the injected clock, never SQL now(), so the fake
// clock drives due times, backoff and leases in tests.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import type { AppDb } from "../db/app-db";
import { outbox, type OutboxRow } from "../db/schema";
import { EVENT_PAYLOADS, SUBSCRIBERS, type EventType } from "./events";
import { describeFailure } from "./failure";
import {
  HANDLERS,
  isKnownHandler,
  type Delivery,
  type OutboxDeps,
} from "./handlers";
import { handlersInQueue, type QueueName } from "./queues";
import {
  DEFAULT_RETRY_POLICY,
  claimUntil,
  settleDelivery,
  type DeliveryOutcome,
} from "./retry-policy";

export type { OutboxDeps } from "./handlers";

/** What one drain did. */
export type DrainReport = {
  /** Handled: done for good. */
  dispatched: number;
  /** Failed, and due again after a backoff. */
  retried: number;
  /**
   * Failed for the last time, or used its last try without a result (the
   * lease ran out): kept as failed for staff to see.
   */
  failed: number;
  /**
   * Due, but for a handler this code doesn't have: left pending and
   * untouched for the deployment that wrote it (a preview's shared worker
   * may run older code than the preview).
   */
  skipped: number;
};

export type DrainOptions = {
  /** The most deliveries one pass claims. */
  limit?: number;
  /**
   * Whose deliveries to claim (./queues.ts): "default" leaves the
   * dedicated queues' handlers to their own workers.
   */
  queue?: QueueName;
};

/**
 * Small enough that one pass's handlers normally finish inside one lease
 * (DEFAULT_RETRY_POLICY.leaseMs, 5 minutes). Deliveries whose lease runs
 * out before their turn are left for the next claim.
 */
export const DEFAULT_DRAIN_LIMIT = 25;

const KNOWN_HANDLERS = Object.keys(HANDLERS);

const POLICY = DEFAULT_RETRY_POLICY;

/** Pending, due by `now`, and not held by a live claim. */
function due(now: Date) {
  return and(
    eq(outbox.status, "pending"),
    lte(outbox.availableAt, now),
    or(isNull(outbox.lockedUntil), lte(outbox.lockedUntil, now))
  );
}

/**
 * Marks failed every delivery that used all its tries without a result:
 * its last claim's lease ran out and no relay settled it (the worker died,
 * or the handler hung). settleDelivery() caps tries only for a handler that
 * returns or throws, so without this such a delivery would be claimed
 * again every lease, forever, and never show as failed.
 */
async function failLostClaims(
  db: AppDb,
  now: Date,
  handlers: string[]
): Promise<number> {
  const failed = await db
    .update(outbox)
    .set({
      status: "failed",
      failedAt: now,
      lockedUntil: null,
      lastError: sql`'No result after ' || ${outbox.attempts} || ' attempts: the lease ran out'`,
    })
    .where(
      and(
        eq(outbox.status, "pending"),
        lte(outbox.lockedUntil, now),
        gte(outbox.attempts, POLICY.maxAttempts),
        inArray(outbox.handler, handlers)
      )
    )
    .returning({ id: outbox.id });
  return failed.length;
}

/**
 * Claims up to `limit` due deliveries in one statement: each gets one more
 * attempt and a lease. SKIP LOCKED keeps two relays on one database from
 * claiming the same row. A delivery that has used all its tries is never
 * claimed again (failLostClaims() fails it).
 */
async function claim(
  db: AppDb,
  now: Date,
  limit: number,
  handlers: string[]
): Promise<OutboxRow[]> {
  const ids = db
    .select({ id: outbox.id })
    .from(outbox)
    .where(
      and(
        due(now),
        lt(outbox.attempts, POLICY.maxAttempts),
        inArray(outbox.handler, handlers)
      )
    )
    .orderBy(asc(outbox.availableAt), asc(outbox.id))
    .limit(limit)
    .for("update", { skipLocked: true });
  const claimed = await db
    .update(outbox)
    .set({
      attempts: sql`${outbox.attempts} + 1`,
      lockedUntil: claimUntil(now, POLICY),
    })
    .where(inArray(outbox.id, ids))
    .returning();
  return claimed.toSorted(
    (a, b) =>
      a.availableAt.getTime() - b.availableAt.getTime() ||
      a.id.localeCompare(b.id)
  );
}

async function countSkipped(db: AppDb, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(outbox)
    .where(and(due(now), notInArray(outbox.handler, KNOWN_HANDLERS)));
  return row?.n ?? 0;
}

/** The row's payload, checked against its event's schema. */
function payloadOf(row: OutboxRow) {
  const subscribers: readonly string[] | undefined = Object.hasOwn(
    SUBSCRIBERS,
    row.eventType
  )
    ? SUBSCRIBERS[row.eventType as EventType]
    : undefined;
  if (!subscribers?.includes(row.handler)) {
    throw new Error(
      `Handler ${row.handler} does not handle ${row.eventType} events`
    );
  }
  const parsed = EVENT_PAYLOADS[row.eventType as EventType].safeParse(
    row.payload
  );
  if (!parsed.success) {
    // Paths only: a value in the message could be personal data.
    const paths = parsed.error.issues.map(
      (issue) => issue.path.join(".") || "(root)"
    );
    throw new Error(
      `The ${row.eventType} payload does not match its schema at ${paths.join(", ")}`
    );
  }
  return parsed.data;
}

async function run(deps: OutboxDeps, row: OutboxRow): Promise<DeliveryOutcome> {
  try {
    if (!isKnownHandler(row.handler)) {
      throw new Error(`No handler named ${row.handler}`);
    }
    const delivery: Delivery = {
      id: row.id,
      eventId: row.eventId,
      occurredAt: row.occurredAt,
      attempt: row.attempts,
      payload: payloadOf(row),
    };
    // payloadOf checked that this handler takes this event's payload.
    await (
      HANDLERS[row.handler] as (
        deps: OutboxDeps,
        delivery: Delivery
      ) => Promise<void>
    )(deps, delivery);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeFailure(error) };
  }
}

/**
 * One pass: claims up to `limit` due deliveries, runs each one's handler in
 * turn and settles it. A delivery whose lease has run out before its turn
 * is not started, and one whose claim was taken over while its handler ran
 * is left to the relay that took it.
 */
export async function drainOutbox(
  deps: OutboxDeps,
  { limit = DEFAULT_DRAIN_LIMIT, queue = "default" }: DrainOptions = {}
): Promise<DrainReport> {
  const now = deps.clock.now();
  const handlers = handlersInQueue(queue, KNOWN_HANDLERS);
  const lost = await failLostClaims(deps.db, now, handlers);
  const claimed = await claim(deps.db, now, limit, handlers);
  const report: DrainReport = {
    dispatched: 0,
    retried: 0,
    failed: lost,
    skipped: await countSkipped(deps.db, now),
  };
  for (const row of claimed) {
    // An earlier handler in this pass took so long that this claim's lease
    // ran out: another relay may have it now, so don't start it here.
    if (row.lockedUntil && deps.clock.now() >= row.lockedUntil) continue;
    const outcome = await run(deps, row);
    const settlement = settleDelivery(row, outcome, deps.clock.now(), POLICY);
    // Still ours only if no other relay claimed it after our lease ran out.
    const settled = await deps.db
      .update(outbox)
      .set(settlement)
      .where(
        and(
          eq(outbox.id, row.id),
          eq(outbox.status, "pending"),
          eq(outbox.attempts, row.attempts)
        )
      )
      .returning({ id: outbox.id });
    if (settled.length === 0) continue;
    report[settlement.status === "pending" ? "retried" : settlement.status] +=
      1;
  }
  return report;
}

/** Thrown when draining never runs out of due deliveries. */
export class DrainNeverIdleError extends Error {
  constructor(passes: number) {
    super(
      `The outbox still had due deliveries after ${passes} passes; a ` +
        `handler may be emitting an event that is due at once, forever.`
    );
    this.name = "DrainNeverIdleError";
  }
}

/**
 * Drains pass after pass until one claims nothing, and adds up what they
 * did (`skipped` is the last pass's count). Deliveries waiting on a
 * backoff are not due, so this returns; they wait for the clock.
 */
export async function drainUntilIdle(
  deps: OutboxDeps,
  { maxPasses = 100, ...options }: DrainOptions & { maxPasses?: number } = {}
): Promise<DrainReport> {
  const total: DrainReport = {
    dispatched: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
  };
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const report = await drainOutbox(deps, options);
    total.dispatched += report.dispatched;
    total.retried += report.retried;
    total.failed += report.failed;
    total.skipped = report.skipped;
    if (report.dispatched + report.retried + report.failed === 0) return total;
  }
  throw new DrainNeverIdleError(maxPasses);
}

/** A delivery that failed for good, as staff see it. */
export type FailedDelivery = Pick<
  OutboxRow,
  | "id"
  | "eventId"
  | "eventType"
  | "aggregateType"
  | "aggregateId"
  | "handler"
  | "attempts"
  | "occurredAt"
> & { lastError: string; failedAt: Date };

/** Failed deliveries, newest failure first. */
export async function listFailedDeliveries(
  db: AppDb,
  { limit = 50 }: { limit?: number } = {}
): Promise<FailedDelivery[]> {
  const rows = await db
    .select({
      id: outbox.id,
      eventId: outbox.eventId,
      eventType: outbox.eventType,
      aggregateType: outbox.aggregateType,
      aggregateId: outbox.aggregateId,
      handler: outbox.handler,
      attempts: outbox.attempts,
      occurredAt: outbox.occurredAt,
      lastError: outbox.lastError,
      failedAt: outbox.failedAt,
    })
    .from(outbox)
    .where(eq(outbox.status, "failed"))
    // NULLS LAST, as outbox_failed_failed_at_idx is built, so Postgres reads
    // the index in order instead of sorting every failed row.
    .orderBy(sql`${outbox.failedAt} desc nulls last`, desc(outbox.id))
    .limit(limit);
  return rows.map(({ lastError, failedAt, ...row }) => {
    // outbox_failed_at_when_failed holds both on every failed row.
    if (lastError === null || failedAt === null) {
      throw new Error(
        `Failed delivery ${row.id} lacks last_error or failed_at`
      );
    }
    return { ...row, lastError, failedAt };
  });
}
