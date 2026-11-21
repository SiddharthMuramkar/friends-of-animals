// What happens around every second-factor attempt, whatever the factor:
// a lock refuses it unchecked, a failure is counted and audited (and may
// start a lock), and a success stamps the session and clears the count.
// Loads under plain Node: relative imports only.

import { recordAudit } from "../audit/record";
import type { AppDb } from "../db/app-db";
import type { SecondFactorKind } from "../db/schema";
import type { Clock } from "../ports/clock";
import { lockedUntil, NO_FAILURES, recordFailure } from "./domain/lockout";
import {
  lockLockout,
  saveLockout,
  secondsUntil,
  stampSession,
  type SignedInUser,
} from "./session-factor";
import { SECOND_FACTOR_SETTINGS } from "./settings";

export type Locked = { ok: false; error: "locked"; retryAfterSeconds: number };

type AttemptContext = { clock: Clock; actor: SignedInUser };

/**
 * Runs `attempt` unless the user is locked out, in `tx`, which must be a
 * transaction: the user's lockout row stays locked until it ends.
 */
export async function guardedAttempt<Failure extends string>(
  tx: AppDb,
  ctx: AttemptContext,
  method: SecondFactorKind,
  attempt: () => Promise<{ ok: true } | { ok: false; error: Failure }>
): Promise<{ ok: true } | { ok: false; error: Failure } | Locked> {
  const { actor } = ctx;
  const now = ctx.clock.now();
  const state = await lockLockout(tx, actor.userId);
  const until = lockedUntil(state, now);
  if (until) {
    return {
      ok: false,
      error: "locked",
      retryAfterSeconds: secondsUntil(until, now),
    };
  }

  const result = await attempt();
  if (result.ok) {
    await stampSession(tx, actor.sessionId, now, method);
    await saveLockout(tx, actor.userId, NO_FAILURES);
    return result;
  }

  const failed = recordFailure(state, now, SECOND_FACTOR_SETTINGS.lockout);
  await saveLockout(tx, actor.userId, failed.state);
  const entity = { type: "user", id: actor.userId };
  await recordAudit(tx, ctx, {
    action: "second_factor.failed",
    entity,
    before: null,
    after: { method, reason: result.error },
    actorRole: null,
  });
  if (!failed.lockedNow || !failed.state.lockedUntil) return result;
  await recordAudit(tx, ctx, {
    action: "second_factor.locked",
    entity,
    before: null,
    after: { lockedUntil: failed.state.lockedUntil.toISOString() },
    actorRole: null,
  });
  return {
    ok: false,
    error: "locked",
    retryAfterSeconds: secondsUntil(failed.state.lockedUntil, now),
  };
}
