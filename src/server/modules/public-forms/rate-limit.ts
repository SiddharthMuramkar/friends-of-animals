// Postgres-backed limits for public forms, per sender (#113; the same
// algorithm as the sign-in limiter, src/server/identity/rate-limit.ts).
// Fixed windows: each submission adds one to each of its counters for the
// current window with an atomic upsert. A submission that would pass any
// limit is rolled back, so refused tries don't count. Keys are keyed
// hashes, so the table holds no address or IP.
//
// Loads under plain Node, so no "server-only" here.

import { and, eq, lt, sql } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { formRateLimit } from "../../db/schema";
import {
  fixedWindow,
  latestRetry,
  type RateWindow,
} from "./domain/rate-window";
import type { KeyedHash } from "./keyed-hash";

/** One counter a submission adds to; over `max` in a window is refused. */
export type FormRateRule = {
  /** What `key` is, such as "ip" or "email". */
  scope: string;
  /** Already normalised: an IP network, a lower-cased address. */
  key: string;
  max: number;
  windowMs: number;
};

export type FormAllowance =
  | { ok: true }
  | { ok: false; retryAfter: Date; retryAfterSeconds: number };

class LimitReached extends Error {
  constructor(readonly retry: { retryAfter: Date; retryAfterSeconds: number }) {
    super("limit reached");
  }
}

/**
 * Takes one submission to `form` from each of `rules`' allowances, or
 * reports when the last full window ends. Runs in a savepoint when `db` is
 * a transaction, so a refusal leaves the caller's transaction usable.
 */
export async function takeFormAllowance(
  db: AppDb,
  input: {
    form: string;
    rules: readonly FormRateRule[];
    now: Date;
    hash: KeyedHash;
  }
): Promise<FormAllowance> {
  const { form, rules, now, hash } = input;
  try {
    await db.transaction(async (tx) => {
      // Check every counter: with two full, the sender must wait for the
      // later one to reopen.
      const full: RateWindow[] = [];
      for (const rule of rules) {
        const window = fixedWindow(now, rule.windowMs);
        const [row] = await tx
          .insert(formRateLimit)
          .values({
            form,
            scope: rule.scope,
            keyHash: hash.of(`form_rate_limit:${form}:${rule.scope}`, rule.key),
            windowStart: window.start,
            count: 1,
          })
          .onConflictDoUpdate({
            target: [
              formRateLimit.form,
              formRateLimit.scope,
              formRateLimit.keyHash,
              formRateLimit.windowStart,
            ],
            set: { count: sql`${formRateLimit.count} + 1` },
          })
          .returning({ count: formRateLimit.count });
        if (!row || row.count > rule.max) full.push(window);
      }
      if (full.length > 0) throw new LimitReached(latestRetry(now, full));
      // A window that started longer ago than the longest rule has ended.
      const longest = Math.max(...rules.map((rule) => rule.windowMs));
      await tx
        .delete(formRateLimit)
        .where(
          and(
            eq(formRateLimit.form, form),
            lt(formRateLimit.windowStart, new Date(now.getTime() - longest))
          )
        );
    });
  } catch (error) {
    if (error instanceof LimitReached) return { ok: false, ...error.retry };
    throw error;
  }
  return { ok: true };
}
